/**
 * dsh-status-rotator — node half type declarations.
 *
 * 浏览器半区(lib/client.js)是 dsh 客户端模块加载器直接执行的,没有类型入口;
 * 这里只描述 node 半区导出的公开面。为避免强制依赖 @deepseek-ai/cordis 的类型,
 * 上下文用最小结构描述。
 */

/** apply() 收到的最小 cordis 上下文形状(只列出插件实际用到的部分) */
export interface PluginContext {
	/** 注册副作用,回调返回值作为卸载清理函数 */
	effect(callback: () => void | (() => void), label?: string): void;
	/** 取服务(settings / webServer 等);服务未挂载时返回 undefined */
	get(name: string): unknown;
	/** 监听事件 */
	on(event: string, listener: (...args: unknown[]) => void): void;
}

/** cordis 插件名 */
export declare const name: string;
/** 声明依赖的服务(空数组 = 不等待任何服务,允许在 headless 宿主激活) */
export declare const inject: string[];
/** 激活插件:注册 config.json 的 HTTP 路由并接入 dsh 设置命名空间 */
export declare function apply(ctx: PluginContext): void;

/** 结构校验:拒绝会写坏运行时的配置文档 */
export declare function validateConfigDocument(raw: unknown): Record<string, unknown>;
/** 安全/范围归一化:颜色白名单 + 数值钳制(不改原对象) */
export declare function sanitizeConfigDocument(document: unknown): unknown;
/** 钳制单份 config(顶层或预设内的) */
export declare function sanitizeConfig(config: unknown): unknown;
/** 单个颜色值是否可安全写进注入的 CSS */
export declare function isSafeColor(value: unknown): boolean;
/** 写请求是否可信(同源 + application/json) */
export declare function isTrustedWrite(req: { headers?: Record<string, unknown> }): boolean;
/** 读请求是否可信(非跨站) */
export declare function isTrustedRead(req: { headers?: Record<string, unknown> }): boolean;
/** 合并配置文档:settings 层按顶层键覆盖文件层 */
export declare function mergeDocuments(fileDoc: unknown, userDoc: unknown): unknown;
/** 解析设置命名空间(兼容 dsh-settings 导出面收窄) */
export declare function resolveSettingsNamespace(settingsModule: unknown, name: string): string;
