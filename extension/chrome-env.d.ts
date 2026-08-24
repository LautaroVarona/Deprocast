/** Tipos mínimos de Chrome MV3 usados por El Cofre. */

declare namespace chrome {
  interface Port {
    name: string
    disconnect(): void
    postMessage(message: unknown): void
    onDisconnect: { addListener(cb: () => void): void }
    onMessage: { addListener(cb: (message: unknown) => void): void }
  }

  namespace runtime {
    const lastError: { message?: string } | undefined
    const id: string
    function getURL(path: string): string
    function connect(connectInfo?: { name?: string }): Port
    function sendMessage(
      message: unknown,
      responseCallback?: (response: unknown) => void,
    ): void
    const onMessage: {
      addListener(
        cb: (
          message: unknown,
          sender: unknown,
          sendResponse: (response?: unknown) => void,
        ) => boolean | void,
      ): void
    }
    const onConnect: {
      addListener(cb: (port: Port) => void): void
    }
  }

  namespace offscreen {
    function createDocument(options: {
      url: string
      reasons: string[]
      justification: string
    }): Promise<void>
    function closeDocument(): Promise<void>
    function hasDocument(): Promise<boolean>
  }

  namespace action {
    function setBadgeText(details: { text: string }): Promise<void> | void
    function setBadgeBackgroundColor(details: { color: string }): Promise<void> | void
  }

  namespace alarms {
    function create(
      name: string,
      alarmInfo: { periodInMinutes?: number; delayInMinutes?: number },
    ): void
    function clear(name: string): Promise<boolean> | void
    const onAlarm: {
      addListener(cb: (alarm: { name: string }) => void): void
    }
  }

  namespace storage {
    interface Area {
      get(
        keys?: string | string[] | Record<string, unknown> | null,
      ): Promise<Record<string, unknown>>
      set(items: Record<string, unknown>): Promise<void>
      remove(keys: string | string[]): Promise<void>
    }
    const session: Area
    const local: Area
  }

  namespace tabs {
    interface Tab {
      id?: number
      url?: string
      title?: string
      active?: boolean
      windowId?: number
    }
    function query(queryInfo: Record<string, unknown>): Promise<Tab[]>
    function get(tabId: number): Promise<Tab>
    const onActivated: {
      addListener(cb: (info: { tabId: number; windowId: number }) => void): void
      removeListener(cb: (info: { tabId: number; windowId: number }) => void): void
    }
    const onUpdated: {
      addListener(
        cb: (
          tabId: number,
          change: { url?: string; title?: string; status?: string },
          tab: Tab,
        ) => void,
      ): void
      removeListener(
        cb: (
          tabId: number,
          change: { url?: string; title?: string; status?: string },
          tab: Tab,
        ) => void,
      ): void
    }
  }

  namespace tabCapture {
    function getMediaStreamId(options: {
      targetTabId?: number
    }): Promise<string>
  }

  namespace desktopCapture {
    function chooseDesktopMedia(
      sources: Array<'screen' | 'window' | 'tab' | 'audio'>,
      callback: (streamId: string) => void,
    ): number
  }
}
