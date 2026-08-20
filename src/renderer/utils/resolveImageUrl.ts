import { LOCAL_RESOURCE_SCHEME } from '../../shared/constants'

/**
 * 提取文件所在目录（纯字符串实现，renderer 无 node:path）。
 * '/a/b/c.md' -> '/a/b'；根目录文件 '/c.md' -> '/'；无分隔符返回 null。
 */
export function dirname(p: string): string | null {
  const idx = p.lastIndexOf('/')
  if (idx < 0) return null
  if (idx === 0) return '/'
  return p.slice(0, idx)
}

/** 将绝对路径逐段编码为 local-resource URL（保留路径分隔符，兼容中文/空格/#/? 文件名） */
function toLocalResourceUrl(absolutePath: string): string {
  const encoded = absolutePath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
  return `${LOCAL_RESOURCE_SCHEME}://localhost${encoded}`
}

const PASSTHROUGH_RE = /^(data:|blob:|https?:|\/\/)/
const LOCAL_RESOURCE_PREFIX = `${LOCAL_RESOURCE_SCHEME}://`

/**
 * markdown 图片 src 解析（互斥分类，无"本地失败转 web"回退）：
 * - data:/blob:/http(s)://、协议相对 //、已是本协议 → 原样透传（web 通道）
 * - 绝对路径 → 直接走本协议
 * - 相对路径 + baseDir → 借 URL 解析处理 ./ ../ → 走本协议
 * - 相对路径 + 无 baseDir → 原样透传（无基准，由 img onError 占位符兜底）
 */
export function resolveImageSrc(src: string, baseDir: string | null): string {
  if (!src) return src
  if (PASSTHROUGH_RE.test(src) || src.startsWith(LOCAL_RESOURCE_PREFIX)) return src

  // file:// 直连在 http 页面（dev 模式）会被 Chromium 拦截，转走本协议
  if (src.startsWith('file://')) {
    try {
      return toLocalResourceUrl(decodeURIComponent(new URL(src).pathname))
    } catch {
      return src
    }
  }

  if (src.startsWith('/')) {
    return toLocalResourceUrl(src)
  }

  if (baseDir) {
    try {
      // 根目录 baseDir('/')拼接时避免产生双斜杠
      const encodedBase = baseDir === '/' ? `${LOCAL_RESOURCE_SCHEME}://localhost/` : `${toLocalResourceUrl(baseDir)}/`
      const resolved = new URL(encodeURIComponent(src).replace(/%2F/g, '/'), encodedBase)
      return `${LOCAL_RESOURCE_SCHEME}://localhost${resolved.pathname}`
    } catch {
      return src
    }
  }

  return src
}
