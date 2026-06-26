'use client'

// Heavy client runtime (Ant Design + its React 19 patch + the SWR cache layer)
// scoped to the authenticated app only. Mounting this inside the (dashboard) and
// (admin) layouts — instead of the root layout — keeps the PUBLIC auth pages and
// the root shell free of Ant Design's JS, so the pages Google actually crawls
// ship far less JavaScript.
import '@ant-design/v5-patch-for-react-19'
import { AntdRegistry } from '@ant-design/nextjs-registry'
import SWRProvider from '@/components/providers/SWRProvider'

export default function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <AntdRegistry>
      <SWRProvider>{children}</SWRProvider>
    </AntdRegistry>
  )
}
