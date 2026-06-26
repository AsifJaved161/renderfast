'use client'

import useSWR from 'swr'
import { Row, Col, Card, Table, Tag, Typography, Empty, Statistic, Tabs } from 'antd'
import {
  FileTextOutlined,
  CopyOutlined,
  AlignLeftOutlined,
  BugOutlined,
  GlobalOutlined,
  CompassOutlined,
} from '@ant-design/icons'
import { StatTitle } from '@/components/ui/StatTitle'
import { useDashboard } from '@/lib/dashboard-context'

const BRAND = '#2da01d'
const { Title, Text } = Typography

interface Report {
  domain: string
  empty: boolean
  message?: string
  totals: { analyzedPages: number; innerLinks: number; pagesWithCanonical: number; innerRedirects: number }
  duplicateTitles: { title: string; count: number; pages: string[] }[]
  duplicateContents: { sample: string; count: number; pages: string[] }[]
  lowWordCount: { url: string; wordCount: number }[]
  jsErrors: { url: string; count: number }[]
  missingHreflang: { url: string; expectedFrom: string[]; count: number }[]
  explorer: { url: string; httpStatus: number | null; title: string | null; canonical: string | null; innerLinks: number; referrers: number }[]
}

const linkCol = (u: string) => (
  <a href={u} target="_blank" rel="noopener noreferrer">{u}</a>
)

// Renders a nested list of page URLs (used as the expandable row for grouped reports).
function PageList({ pages }: { pages: string[] }) {
  return (
    <ul style={{ margin: 0, paddingInlineStart: 18 }}>
      {pages.map((p) => (
        <li key={p}>{linkCol(p)}</li>
      ))}
    </ul>
  )
}

export default function SeoReportsPage() {
  const { selectedSiteId } = useDashboard()
  const siteId = selectedSiteId ?? undefined

  const { data, isLoading } = useSWR<Report>(siteId ? `/api/seo-reports/${siteId}` : null)

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <Title level={3} style={{ margin: 0 }}>SEO Reports</Title>
        <Text type="secondary">
          Technical-SEO issues found across your rendered pages — duplicates, thin content, broken
          alternate links and a full page explorer. Built from Bot Visibility scans &amp; live renders.
        </Text>
      </div>

      {!siteId ? (
        <Card><Empty description="Select a site (top-right) to view its SEO reports." /></Card>
      ) : isLoading && !data ? (
        <Card loading />
      ) : !data || data.empty ? (
        <Card>
          <Empty description={data?.message ?? 'No analysed pages yet — run a Bot Visibility scan first.'} />
        </Card>
      ) : (
        <>
          {/* ── Structure totals ──────────────────────────────────────────────── */}
          <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
            <Col xs={12} lg={6}>
              <Card><Statistic title={<StatTitle hint="Distinct pages we've rendered & analysed for this site.">Analysed Pages</StatTitle>} value={data.totals.analyzedPages} /></Card>
            </Col>
            <Col xs={12} lg={6}>
              <Card><Statistic title={<StatTitle hint="Total internal links found across the analysed pages.">Inner Links</StatTitle>} value={data.totals.innerLinks} /></Card>
            </Col>
            <Col xs={12} lg={6}>
              <Card><Statistic title={<StatTitle hint="Pages that declare a <link rel=canonical>.">With Canonical</StatTitle>} value={data.totals.pagesWithCanonical} /></Card>
            </Col>
            <Col xs={12} lg={6}>
              <Card><Statistic title={<StatTitle hint="Analysed pages whose URL returned a 3xx redirect.">Inner Redirects</StatTitle>} value={data.totals.innerRedirects} /></Card>
            </Col>
          </Row>

          <Tabs
            defaultActiveKey="explorer"
            items={[
              {
                key: 'explorer',
                label: <span><CompassOutlined /> Page Explorer ({data.explorer.length})</span>,
                children: (
                  <Card>
                    <Table
                      rowKey="url"
                      size="small"
                      dataSource={data.explorer}
                      pagination={{ pageSize: 20, showSizeChanger: false }}
                      columns={[
                        { title: 'URL', dataIndex: 'url', ellipsis: true, render: linkCol },
                        {
                          title: 'Status', dataIndex: 'httpStatus', width: 90,
                          render: (c: number | null) =>
                            c ? <Tag color={c < 300 ? 'green' : c < 400 ? 'orange' : 'red'}>{c}</Tag> : <Text type="secondary">—</Text>,
                        },
                        { title: 'Title', dataIndex: 'title', ellipsis: true, render: (t: string | null) => t || <Text type="secondary">[none]</Text> },
                        {
                          title: 'Canonical', dataIndex: 'canonical', width: 90, align: 'center',
                          render: (c: string | null) => (c ? <Tag color="blue">yes</Tag> : <Text type="secondary">—</Text>),
                        },
                        { title: 'Links', dataIndex: 'innerLinks', width: 80 },
                        {
                          title: <StatTitle hint="How many analysed pages link to this page.">Referrers</StatTitle>,
                          dataIndex: 'referrers', width: 110,
                        },
                      ]}
                    />
                  </Card>
                ),
              },
              {
                key: 'dup-titles',
                label: <span><FileTextOutlined /> Duplicate Titles ({data.duplicateTitles.length})</span>,
                children: (
                  <Card>
                    <Table
                      rowKey="title"
                      size="small"
                      dataSource={data.duplicateTitles}
                      pagination={{ pageSize: 15 }}
                      locale={{ emptyText: 'No duplicate titles 🎉' }}
                      expandable={{ expandedRowRender: (r) => <PageList pages={r.pages} /> }}
                      columns={[
                        { title: 'Title', dataIndex: 'title', ellipsis: true },
                        { title: 'Pages', dataIndex: 'count', width: 100 },
                      ]}
                    />
                  </Card>
                ),
              },
              {
                key: 'dup-content',
                label: <span><CopyOutlined /> Duplicate Content ({data.duplicateContents.length})</span>,
                children: (
                  <Card>
                    <Table
                      rowKey="sample"
                      size="small"
                      dataSource={data.duplicateContents}
                      pagination={{ pageSize: 15 }}
                      locale={{ emptyText: 'No duplicate content 🎉' }}
                      expandable={{ expandedRowRender: (r) => <PageList pages={r.pages} /> }}
                      columns={[
                        { title: 'Example page', dataIndex: 'sample', ellipsis: true, render: linkCol },
                        { title: 'Duplicates', dataIndex: 'count', width: 110 },
                      ]}
                    />
                  </Card>
                ),
              },
              {
                key: 'low-words',
                label: <span><AlignLeftOutlined /> Low Word Count ({data.lowWordCount.length})</span>,
                children: (
                  <Card>
                    <Table
                      rowKey="url"
                      size="small"
                      dataSource={data.lowWordCount}
                      pagination={{ pageSize: 20 }}
                      locale={{ emptyText: 'No thin-content pages 🎉' }}
                      columns={[
                        { title: 'URL', dataIndex: 'url', ellipsis: true, render: linkCol },
                        {
                          title: 'Words', dataIndex: 'wordCount', width: 110,
                          render: (n: number) => <Tag color={n < 50 ? 'red' : n < 120 ? 'orange' : 'default'}>{n}</Tag>,
                        },
                      ]}
                    />
                  </Card>
                ),
              },
              {
                key: 'hreflang',
                label: <span><GlobalOutlined /> Missing hreflang ({data.missingHreflang.length})</span>,
                children: (
                  <Card>
                    <Table
                      rowKey="url"
                      size="small"
                      dataSource={data.missingHreflang}
                      pagination={{ pageSize: 15 }}
                      locale={{ emptyText: 'No missing hreflang confirmation links 🎉' }}
                      expandable={{ expandedRowRender: (r) => (
                        <div>
                          <Text type="secondary">Should link back to:</Text>
                          <PageList pages={r.expectedFrom} />
                        </div>
                      ) }}
                      columns={[
                        { title: 'Page missing confirmation link', dataIndex: 'url', ellipsis: true, render: linkCol },
                        { title: 'Missing', dataIndex: 'count', width: 100 },
                      ]}
                    />
                  </Card>
                ),
              },
              {
                key: 'js-errors',
                label: <span><BugOutlined /> JS Errors ({data.jsErrors.length})</span>,
                children: (
                  <Card>
                    <Table
                      rowKey="url"
                      size="small"
                      dataSource={data.jsErrors}
                      pagination={{ pageSize: 20 }}
                      locale={{ emptyText: 'No pages with JavaScript errors 🎉' }}
                      columns={[
                        { title: 'URL', dataIndex: 'url', ellipsis: true, render: linkCol },
                        { title: 'Errors', dataIndex: 'count', width: 100, render: (n: number) => <Tag color="red">{n}</Tag> },
                      ]}
                    />
                  </Card>
                ),
              },
            ]}
          />
        </>
      )}
    </div>
  )
}
