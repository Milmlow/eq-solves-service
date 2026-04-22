import { useEffect, useMemo, useState } from 'react'
import { navigate, useRoute } from './lib/router'
import { ExportPage } from './pages/ExportPage'
import { DebugPage } from './pages/DebugPage'
import { AdminPage } from './pages/AdminPage'
import { ImportPage } from './pages/ImportPage'
import { ReimportPage } from './pages/ReimportPage'
import { DashboardPage } from './pages/DashboardPage'
import { JobsListPage } from './pages/JobsListPage'
import { JobScreenPage } from './pages/JobScreenPage'
import { JobGuard } from './components/JobGuard'
import { AppShell } from './components/shell/AppShell'
import type { JobContext, NavId } from './components/shell/AppShell'
import { NameModal } from './components/modals/NameModal'
import { useCapturer } from './hooks/useCapturer'
import { useSyncState } from './hooks/useSyncState'
import { useAssets, useFields, useJob } from './hooks/useJobData'
import { allCaptures, subscribeQueue } from './lib/queue'

export default function App() {
  const route = useRoute()
  const { name, setName } = useCapturer()
  const sync = useSyncState()
  const [nameOpen, setNameOpen] = useState(false)

  // Re-render whenever the local queue changes so Sidebar's active-job
  // progress card stays live without a page reload.
  const [, tick] = useState(0)
  useEffect(() => subscribeQueue(() => tick(v => v + 1)), [])

  // Pull current job context (if any) so the sidebar's active-job card
  // + job-scoped nav buttons light up regardless of which route we're on.
  const currentJobRef =
    route.name === 'job' ||
    route.name === 'asset' ||
    route.name === 'admin' ||
    route.name === 'export' ||
    route.name === 'reimport'
      ? route.jobRef
      : null
  const { job } = useJob(currentJobRef)
  const { assets } = useAssets(job?.id ?? null)
  const { fields } = useFields(job?.classification_code ?? null)

  const jobCtx: JobContext | null = useMemo(() => {
    if (!job) return null
    const captured = fields.filter(f => f.is_field_captured)
    const captureFieldIds = new Set(captured.map(f => f.id))
    const totalPerAsset = captured.length
    const total = assets.length * totalPerAsset

    const assetIds = new Set(assets.map(a => a.id))
    let done = 0
    for (const c of allCaptures()) {
      if (!assetIds.has(c.assetId)) continue
      if (!captureFieldIds.has(c.classificationFieldId)) continue
      if (c.value && c.value.trim() !== '') done += 1
    }
    return {
      name: job.name ?? job.slug ?? job.id.slice(0, 8),
      site_code: job.site_code,
      classification_code: job.classification_code,
      done,
      total,
    }
  }, [job, assets, fields, sync.pending, sync.syncing])

  const onNavigate = (id: NavId) => {
    const jobSeg = job ? (job.slug ?? job.id) : null
    switch (id) {
      case 'home':
        navigate('/')
        break
      case 'jobs':
        navigate('/jobs')
        break
      case 'assets':
        if (jobSeg) navigate(`/j/${jobSeg}`)
        break
      case 'admin':
        if (jobSeg) navigate(`/j/${jobSeg}/admin`)
        break
      case 'export':
        if (jobSeg) navigate(`/j/${jobSeg}/export`)
        break
      case 'reimport':
        if (jobSeg) navigate(`/j/${jobSeg}/reimport`)
        break
      case 'import':
        navigate('/import')
        break
      case 'debug':
        navigate('/debug')
        break
    }
  }

  const nameModal = (
    <NameModal
      open={nameOpen || name === null}
      initialValue={name}
      dismissable={name !== null}
      onSubmit={v => {
        setName(v)
        setNameOpen(false)
      }}
      onClose={() => setNameOpen(false)}
    />
  )

  // Which nav id is active, given the current route
  const activeNav: NavId =
    route.name === 'home'
      ? 'home'
      : route.name === 'jobs'
        ? 'jobs'
        : route.name === 'job' || route.name === 'asset'
          ? 'assets'
          : route.name === 'admin'
            ? 'admin'
            : route.name === 'export'
              ? 'export'
              : route.name === 'reimport'
                ? 'reimport'
                : route.name === 'import'
                  ? 'import'
                  : 'debug'

  // Shell wrapper helper — every v2 page goes through this.
  const Shell = ({
    title,
    subtitle,
    children,
    padded = true,
    bgClassName,
  }: {
    title: string
    subtitle?: string
    children: React.ReactNode
    padded?: boolean
    bgClassName?: string
  }) => (
    <AppShell
      active={activeNav}
      onNavigate={onNavigate}
      title={title}
      subtitle={subtitle}
      jobCtx={jobCtx}
      online={sync.online}
      pending={sync.pending}
      syncing={sync.syncing}
      onSync={sync.sync}
      captureBy={name}
      onChangeName={() => setNameOpen(true)}
      padded={padded}
      bgClassName={bgClassName}
    >
      {children}
    </AppShell>
  )

  if (route.name === 'home') {
    return (
      <>
        <Shell title="Dashboard" subtitle="Overview of every active capture">
          <DashboardPage capturerName={name} />
        </Shell>
        {nameModal}
      </>
    )
  }

  if (route.name === 'jobs') {
    return (
      <>
        <Shell title="Jobs" subtitle="Every capture, filtered">
          <JobsListPage />
        </Shell>
        {nameModal}
      </>
    )
  }

  if (route.name === 'job' || route.name === 'asset') {
    const subtitle = job ? `${job.site_code} · ${job.classification_code}` : 'Loading…'
    const title = job?.name ?? 'Job'
    return (
      <>
        <Shell title={title} subtitle={subtitle}>
          <JobGuard jobRef={route.jobRef}>
            <JobScreenPage
              jobRef={route.jobRef}
              assetId={route.name === 'asset' ? route.assetId : null}
            />
          </JobGuard>
        </Shell>
        {nameModal}
      </>
    )
  }

  // Legacy routes — rendered inside the shell for nav continuity; individual
  // pages will be rebuilt in subsequent tasks.
  if (route.name === 'import') {
    return (
      <>
        <Shell title="Import template" subtitle="Load a job from an Excel template">
          <ImportPage />
        </Shell>
        {nameModal}
      </>
    )
  }

  if (route.name === 'debug') {
    return (
      <>
        <Shell title="Self-check" subtitle="Diagnostic health checks">
          <DebugPage />
        </Shell>
        {nameModal}
      </>
    )
  }

  if (route.name === 'admin') {
    const subtitle = job ? `${job.site_code} · ${job.classification_code}` : 'Loading…'
    return (
      <>
        <Shell title="Progress matrix" subtitle={subtitle}>
          <JobGuard jobRef={route.jobRef}>
            <AdminPage jobRef={route.jobRef} />
          </JobGuard>
        </Shell>
        {nameModal}
      </>
    )
  }

  if (route.name === 'export') {
    const subtitle = job ? `${job.site_code} · ${job.classification_code}` : 'Loading…'
    return (
      <>
        <Shell title="Export" subtitle={subtitle}>
          <JobGuard jobRef={route.jobRef}>
            <ExportPage jobRef={route.jobRef} />
          </JobGuard>
        </Shell>
        {nameModal}
      </>
    )
  }

  if (route.name === 'reimport') {
    const subtitle = job ? `${job.site_code} · ${job.classification_code}` : 'Loading…'
    return (
      <>
        <Shell title="Load capture" subtitle={subtitle}>
          <JobGuard jobRef={route.jobRef}>
            <ReimportPage jobRef={route.jobRef} />
          </JobGuard>
        </Shell>
        {nameModal}
      </>
    )
  }

  return nameModal
}
