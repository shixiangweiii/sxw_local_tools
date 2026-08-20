// 本地图片安全通道协议：renderer 无法直接读取磁盘文件，经此协议由 main 进程代理加载
export const LOCAL_RESOURCE_SCHEME = 'local-resource'

export const IPC_CHANNELS = {
  FILE_OPEN: 'file:open',
  FILE_SAVE: 'file:save',
  WINDOW_NEW: 'window:new',
  WINDOW_SET_TITLE: 'window:set-title',
  WINDOW_GET_INIT_CONFIG: 'window:get-init-config'
} as const
