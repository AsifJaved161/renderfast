'use client'

import { Tooltip, Space } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'

// A Statistic/label title with a 1-line hover hint (info icon). Pass as the
// `title` of an antd <Statistic> or use anywhere a labelled value needs a hint.
export function StatTitle({ children, hint }: { children: React.ReactNode; hint: string }) {
  return (
    <Space size={4}>
      {children}
      <Tooltip title={hint}>
        <InfoCircleOutlined style={{ color: '#bfbfbf', fontSize: 12, cursor: 'help' }} />
      </Tooltip>
    </Space>
  )
}
