'use client'

import '@ant-design/v5-patch-for-react-19'
import { ConfigProvider } from 'antd'
import type { ThemeConfig } from 'antd'

const theme: ThemeConfig = {
  token: {
    colorPrimary: '#2DA01D',
    colorLink: '#2DA01D',
    colorLinkHover: '#248217',
    borderRadius: 6,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontSize: 13,
  },
  components: {
    Layout: {
      siderBg: '#ffffff',
      headerBg: '#ffffff',
      headerHeight: 64,
      bodyBg: '#f9fafb',
    },
    Menu: {
      itemSelectedBg: '#e8fae5',
      itemSelectedColor: '#2da01d',
      itemHoverBg: '#f9fafb',
      itemHoverColor: '#111827',
      iconSize: 15,
      itemHeight: 40,
      activeBarWidth: 0,
      activeBarBorderWidth: 0,
    },
    Button: {
      borderRadius: 6,
    },
    Drawer: {
      paddingLG: 0,
    },
  },
}

export default function AntdProvider({ children }: { children: React.ReactNode }) {
  return <ConfigProvider theme={theme}>{children}</ConfigProvider>
}
