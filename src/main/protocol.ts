import { protocol, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { LOCAL_RESOURCE_SCHEME } from '../shared/constants'

// 扩展名白名单：协议只放行图片，防止渲染层被注入后借协议读取任意文件
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i

/**
 * 声明协议特权，必须在 app ready 之前调用（Electron 限制）。
 * standard: 支持 URL 解析语义；secure: http(s) 页面（dev 模式）也可加载。
 */
export function registerSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: LOCAL_RESOURCE_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true }
    }
  ])
}

/**
 * 注册协议处理器，必须在 app ready 之后调用。
 * URL 形态：local-resource://localhost/<encodeURIComponent 后的绝对路径>
 * 路径放在 pathname 而非 hostname，因为 hostname 会被 URL 解析器小写化，
 * macOS 文件系统大小写敏感。
 */
export function registerLocalResourceProtocol(): void {
  protocol.handle(LOCAL_RESOURCE_SCHEME, async (request) => {
    try {
      const filePath = decodeURIComponent(new URL(request.url).pathname)
      if (
        !filePath.startsWith('/') ||
        filePath.split('/').includes('..') ||
        !IMAGE_EXT_RE.test(filePath)
      ) {
        return new Response(null, { status: 403 })
      }
      return await net.fetch(pathToFileURL(filePath).toString())
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}
