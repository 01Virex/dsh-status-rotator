"""Rebuild twist from original vector keys with fin correspondence and transported folds.

Called by generate-smooth-tail.cjs. This helper only writes the generated JSON.
Dependencies: NumPy, Pillow, opencv-python-headless 5.0.0.93, Shapely.
"""
import argparse, json, math, pathlib, re, sys
ROOT=pathlib.Path(__file__).resolve().parent
import cv2
import numpy as np
from shapely import box,unary_union
from PIL import Image,ImageChops,ImageDraw

cv2.setNumThreads(1)
cv2.setRNGSeed(0)
SCALE=1.5;OX=2;OY=4;H=W=512;CUT=round(185*SCALE+OY)

def parse(pose):
    parts=[]
    for section in re.findall(r'M([^M]+)',pose):
        values=list(map(float,re.findall(r'[-+]?\d*\.?\d+',section)))
        parts.append(np.array(values,dtype='float64').reshape(-1,2))
    return parts

def raster(parts):
    image=Image.new('1',(W*4,H*4),0)
    for part in parts:
        if np.all(part==part[0]):continue
        points=[((x*SCALE+OX)*4,(y*SCALE+OY)*4) for x,y in part]
        layer=Image.new('1',image.size,0);ImageDraw.Draw(layer).polygon(points,fill=1)
        image=ImageChops.logical_xor(image,layer)
    return np.array(image.convert('L').resize((W,H),Image.Resampling.LANCZOS))

def field(mask):
    b=(mask>=128).astype('uint8')
    return cv2.distanceTransform(1-b,cv2.DIST_L2,cv2.DIST_MASK_PRECISE)-cv2.distanceTransform(b,cv2.DIST_L2,cv2.DIST_MASK_PRECISE)

def sample_open(line,n):
    length=np.hypot(*np.diff(line,axis=0).T);cum=np.r_[0,np.cumsum(length)];d=np.linspace(0,cum[-1],n)
    return np.column_stack([np.interp(d,cum,line[:,a]) for a in range(2)]).astype('float32')

def fin_arc(mask):
    # Close only the artificial cut across the neck. Fill the broad fin face,
    # so correspondence is estimated on a solid shape rather than thin ink.
    top=(mask>=128).astype('uint8');top[CUT+1:]=0
    row=np.flatnonzero(top[CUT]);assert len(row)>0
    top[CUT,row.min():row.max()+1]=1
    contours,_=cv2.findContours(top,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_NONE)
    contour=max(contours,key=cv2.contourArea).reshape(-1,2)
    bottom=np.flatnonzero(contour[:,1]==CUT)
    left=bottom[np.argmin(contour[bottom,0])];right=bottom[np.argmax(contour[bottom,0])]
    if left>=right:
        contour=np.roll(contour,-left,axis=0);right=(right-left)%len(contour);left=0
    a=contour[left:right+1];b=np.r_[contour[right:],contour[:left+1]][::-1]
    arc=a if a[:,1].mean()<b[:,1].mean() else b
    top_indices=np.flatnonzero(arc[:,1]==arc[:,1].min());tip=top_indices[len(top_indices)//2]
    assert 0<tip<len(arc)-1
    # Explicit neck-left / high tip / neck-right correspondence.
    return np.r_[sample_open(arc[:tip+1],128)[:-1],sample_open(arc[tip:],128)]

def domain(arc):
    out=np.zeros((H,W),'uint8');cv2.fillPoly(out,[np.rint(arc).astype('int32')],1)
    return out

def solid_fin(arc):
    inside=domain(arc)
    edge=np.ones((H,W),'uint8');cv2.polylines(edge,[np.rint(arc).astype('int32')],False,0,1)
    distance=cv2.distanceTransform(edge,cv2.DIST_L2,cv2.DIST_MASK_PRECISE)
    # Stroke from the moving outer boundary inward; keep the original 16px
    # line weight as the face narrows. Never stroke the artificial neck cap.
    return ((inside>0)&(distance<=16*SCALE)).astype('uint8')*255

def spans(mask):
    present=mask.any(axis=1)
    left=mask.argmax(axis=1).astype('float32')
    right=(W-1-mask[:,::-1].argmax(axis=1)).astype('float32')
    return left,right,present

def area(p):
    q=np.roll(p,-1,axis=0)
    return float(np.sum(p[:,0]*q[:,1]-q[:,0]*p[:,1])/2)

def fixed_points(p,n):
    if area(p)<0:p=p[::-1].copy()
    first=int(np.argmin((p[:,0]-130)**2+(p[:,1]-269)**2));p=np.roll(p,-first,axis=0)
    lengths=np.linalg.norm(np.roll(p,-1,axis=0)-p,axis=1)
    assert len(p)<=n,'Point budget must preserve every simplified vertex'
    splits=np.ones(len(p),dtype='int32')
    for _ in range(n-len(p)):splits[np.argmax(lengths/splits)]+=1
    return np.concatenate([a+(p[(i+1)%len(p)]-a)*np.arange(splits[i])[:,None]/splits[i] for i,a in enumerate(p)])

def emit(parts):
    def num(v):return str(round(float(v),3)).rstrip('0').rstrip('.') if '.' in str(round(float(v),3)) else str(round(float(v),3))
    return ' '.join('M'+' L'.join(num(x)+' '+num(y) for x,y in p)+' Z' for p in parts)

def clean(mask):
    b=(mask>=128).astype('uint8')
    for invert in (False,True):
        n,labels,stats,_=cv2.connectedComponentsWithStats(1-b if invert else b,connectivity=4 if invert else 8)
        for i in range(1,n):
            if stats[i,cv2.CC_STAT_AREA]<4*SCALE*SCALE:b[labels==i]=1 if invert else 0
    return b*255

def component_count(mask):
    n,_,stats,_=cv2.connectedComponentsWithStats((mask>=128).astype('uint8'),8)
    return sum(s[cv2.CC_STAT_AREA]>=4*SCALE*SCALE for s in stats[1:])

def boundary_error(a,b):
    a=(a>=128).astype('uint8');b=(b>=128).astype('uint8')
    ea=a-cv2.erode(a,np.ones((3,3),'uint8'));eb=b-cv2.erode(b,np.ones((3,3),'uint8'))
    da=cv2.distanceTransform(1-ea,cv2.DIST_L2,cv2.DIST_MASK_PRECISE)
    db=cv2.distanceTransform(1-eb,cv2.DIST_L2,cv2.DIST_MASK_PRECISE)
    return float(max(da[eb>0].max(),db[ea>0].max())/SCALE)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--input',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
    spec=json.loads(pathlib.Path(args.input).read_text('utf8'));poses=spec['poses'];assert len(poses)==36
    motion=json.loads((ROOT/'smooth-tail-motion.json').read_text('utf8'));phase=motion['phase']
    raw=[parse(p) for p in poses];inputs=[raster(p) for p in raw]
    arcs=[fin_arc(m) for m in inputs];fields=[field(m) for m in inputs]
    signs=[motion['faceSigns'][(i+phase)%36] for i in range(36)]
    reference=arcs[(motion['edgeOnReference']-phase)%36]
    source_spans=[spans(domain(a)) for a in arcs]
    fin_fields=[field(solid_fin(a)) for a in arcs]
    occlusion_deltas=[];fold_keys=[]
    for i,(source,fin) in enumerate(zip(fields,fin_fields)):
        important=((source<0)!=(fin<0))&(np.maximum(np.abs(source),np.abs(fin))>3*SCALE)
        important[round(170*SCALE+OY):]=False
        # Transport the complete source residual, including where the real
        # neck curves outside the artificial fin cut. Truncating this field
        # would remove those curves even at an unchanged original key.
        occlusion_deltas.append(source-fin)
        if important.any():fold_keys.append((i+phase)%36)
    gx,gy=np.meshgrid(np.arange(W,dtype='float32'),np.arange(H,dtype='float32'))
    blend=np.clip(((np.arange(H)-OY)/SCALE-170)/15,0,1);blend=(blend*blend*(3-2*blend))[:,None]
    flow_cache={};crossings={}
    side_axes={r:float(arcs[(r-phase)%36][127,0]) for r,sign in enumerate(motion['faceSigns']) if sign==0}
    def side_axis(time):
        keys=sorted((r+cycle*36,x) for cycle in (-1,0,1) for r,x in side_axes.items())
        left=max((p for p in keys if p[0]<=time),key=lambda p:p[0]);right=min((p for p in keys if p[0]>=time),key=lambda p:p[0])
        if left[0]==right[0]:return left[1]
        ratio=(time-left[0])/(right[0]-left[0]);return left[1]*(1-ratio)+right[1]*ratio

    def moving_arc(a,b,t):
        aa,bb=arcs[a],arcs[b]
        if signs[a]*signs[b]>=0:return aa*(1-t)+bb*t
        raw_index=(a+phase)%36;axis_a=side_axis(raw_index);axis_b=side_axis(raw_index+1)
        crossing=(axis_a-aa[127,0])/((bb[127,0]-aa[127,0])-(axis_b-axis_a))
        assert 0<crossing<1,('Face annotation and side-view landmarks disagree',raw_index,crossing)
        crossings[(a+phase)%36]=float(crossing)
        neck=aa*(1-crossing)+bb*crossing
        profile=reference.copy();y=reference[:,1]
        source_center=(reference[0,0]+reference[-1,0])/2;source_width=reference[-1,0]-reference[0,0]
        target_center=(neck[0,0]+neck[-1,0])/2;target_width=neck[-1,0]-neck[0,0]
        fraction=np.clip((y-reference[127,1])/(CUT-reference[127,1]),0,1)
        source_axis=reference[127,0]*(1-fraction)+source_center*fraction
        target_axis=neck[127,0]*(1-fraction)+target_center*fraction
        lower=np.clip((y-(155*SCALE+OY))/(30*SCALE),0,1);lower=lower*lower*(3-2*lower)
        profile[:,0]=target_axis+(reference[:,0]-source_axis)*(1+lower*(target_width/source_width-1))
        return aa*(1-t/crossing)+profile*(t/crossing) if t<=crossing else profile*(1-(t-crossing)/(1-crossing))+bb*((t-crossing)/(1-crossing))

    def pair_flow(a,b):
        if (a,b) not in flow_cache:
            dis=cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
            dis.setFinestScale(0);dis.setGradientDescentIterations(40);dis.setVariationalRefinementIterations(10)
            forward=cv2.GaussianBlur(dis.calc(inputs[a],inputs[b],None),(0,0),2)
            backward=cv2.GaussianBlur(dis.calc(inputs[b],inputs[a],None),(0,0),2)
            flow_cache[a,b]=(forward,backward)
        return flow_cache[a,b]

    def transport(source,flow,t,source_arc,target_arc):
        mx=gx-t*flow[:,:,0];my=gy-t*flow[:,:,1]
        for _ in range(4):
            fx=cv2.remap(flow[:,:,0],mx,my,cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE)
            fy=cv2.remap(flow[:,:,1],mx,my,cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE)
            mx=gx-t*fx;my=gy-t*fy
        sl,sr=source_arc[0,0],source_arc[-1,0];tl,tr=target_arc[0,0],target_arc[-1,0]
        cl=sl*(1-t)+tl*t;cr=sr*(1-t)+tr*t
        cage_x=sl+(gx-cl)*(sr-sl)/max(cr-cl,1)
        band=np.exp(-0.5*((gy-CUT)/(12*SCALE))**2)
        mx=mx*(1-band)+cage_x*band;my=my*(1-band)+gy*band
        return cv2.remap(source,mx.astype('float32'),my.astype('float32'),cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE)

    def render(a,b,t):
        arc=moving_arc(a,b,t);upper=field(solid_fin(arc))
        left,right,valid=spans(domain(arc));u=(gx-left[:,None])/np.maximum(right-left,1)[:,None]
        # Carry the original side-on folds inside the moving fin domain. Blending
        # them at their old screen positions would cut across a moving outline.
        for index,weight in ((a,1-t),(b,t)):
            lo,hi,source_valid=source_spans[index];mapping=lo[:,None]+u*(hi-lo)[:,None]
            delta=cv2.remap(occlusion_deltas[index],mapping.astype('float32'),gy,cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT,borderValue=0)
            delta[~(valid&source_valid)]=0;upper+=delta*weight
        if a==b:lower=fields[a]
        else:
            forward,backward=pair_flow(a,b)
            lower=transport(fields[a],forward,t,arcs[a],arcs[b])*(1-t)+transport(fields[b],backward,1-t,arcs[b],arcs[a])*t
        return clean(((upper*(1-blend)+lower*blend)<=0).astype('uint8')*255)

    source_fits=[boundary_error(inputs[i],render(i,i,0)) for i in range(36)]
    source_fit=max(source_fits)
    assert source_fit<=2.5,('Source reconstruction error',source_fit)
    original_components=[component_count(m) for m in inputs]
    bounds=np.concatenate([np.concatenate(p) for p in raw]);lo=bounds.min(axis=0);hi=bounds.max(axis=0)
    frames=[];stats=[];roundtrip_error=0;masks=[]
    for j in range(150):
        u=j*36/150
        if abs(u-round(u))<1e-9:u=round(u)
        a=int(u);b=(a+1)%36;t=u-a
        mask=inputs[a] if t==0 else render(a,b,t)
        count=component_count(mask)
        assert count<=max(original_components[a],original_components[b]),('Extra foreground fragment',j,count)
        if t==0:contours=[p.copy() for p in raw[a]]
        else:
            # Union actual raster cells rather than tracing pixel centres.
            # This keeps thin folds as polygons instead of losing them as
            # zero-area LineStrings when a diagonal connection is repaired.
            cells=[]
            for y,row in enumerate(mask>=128):
                changes=np.diff(np.r_[False,row,False].astype('int8'))
                starts=np.flatnonzero(changes==1);ends=np.flatnonzero(changes==-1)
                for left,right in zip(starts,ends):
                    cells.append(box((left-OX)/SCALE,(y-OY)/SCALE,(right-OX)/SCALE,(y+1-OY)/SCALE))
            geometry=unary_union(cells)
            # Give corner-only pixel contacts a subpixel-width bridge. The
            # maximum displacement is under 0.1 original-coordinate pixel.
            radius=.125/SCALE
            geometry=geometry.buffer(radius,quad_segs=2).buffer(-radius,quad_segs=2)
            geometry=geometry.intersection(box(lo[0],lo[1],hi[0],hi[1]))
            geometry=geometry.simplify(.5,preserve_topology=True)
            contours=[]
            def collect(g):
                if g.geom_type=='Polygon':
                    contours.append(np.array(g.exterior.coords[:-1]))
                    contours.extend(np.array(r.coords[:-1]) for r in g.interiors)
                elif hasattr(g,'geoms'):
                    for sub in g.geoms:collect(sub)
            collect(geometry)
        contours.sort(key=lambda p:abs(area(p)),reverse=True);frames.append(contours);masks.append(mask)
        stats.append({'frame':j,'sourceFrom':(a+phase)%36,'fraction':round(t,5),'foregroundComponents':int(count),'subpaths':len(contours),'inkAreaPx2':round(float((mask>=128).sum()/SCALE**2),2)})
    # Adding vertices on existing edges preserves topology. Do not uniformly
    # resample away concave vertices, which can cross a nearby inner contour.
    slots=max(map(len,frames))
    budgets=[max(256,2**math.ceil(math.log2(max(len(frame[k]) for frame in frames if len(frame)>k)))) for k in range(slots)]
    frames=[[fixed_points(p,budgets[k]) for k,p in enumerate(frame)] for frame in frames]
    for j,(mask,parts) in enumerate(zip(masks,frames)):
        rebuilt=clean(raster(parts));error=boundary_error(mask,rebuilt);roundtrip_error=max(roundtrip_error,error)
        assert error<=2,('Vector reconstruction error',j,error)
        a=int(j*36/150);b=(a+1)%36
        assert component_count(rebuilt)<=max(original_components[a],original_components[b]),('Exported foreground fragment',j)
    for parts in frames:
        while len(parts)<slots:parts.append(np.repeat(parts[0][:1],budgets[len(parts)],axis=0))
    paths=[emit(parts) for parts in frames]
    report={'method':'aligned fin outline, signed face transitions, transported stem and occlusion residuals','versions':{'opencv':cv2.__version__,'numpy':np.__version__},'frames':150,'pointsPerSubpath':budgets,'subpathSlots':slots,'pointsPerFrame':sum(budgets),'maxForegroundComponents':max(s['foregroundComponents'] for s in stats),'extraForegroundFragments':0,'sourceReconstructionHausdorffMaxPx':round(source_fit,4),'vectorRoundtripHausdorffMaxPx':round(roundtrip_error,4),'sourceFoldKeys':sorted(fold_keys),'inferredSideViews':[{'from':a,'to':(a+1)%36,'fraction':round(t,5)} for a,t in sorted(crossings.items())],'regressions':{str(i):stats[i] for i in (55,56,60,61,103,120)},'perFrame':stats}
    pathlib.Path(args.output).write_text(json.dumps({'paths':paths,'report':report},separators=(',',':')),'utf8')
    print('twist motion reconstruction: 150 frames; '+str(sum(budgets))+' points/frame; 0 extra foreground fragments',flush=True)

if __name__=='__main__':main()
