import { useRoute } from './lib/router'
import { HomePage } from './pages/HomePage'
import { JobPage } from './pages/JobPage'
import { AssetPage } from './pages/AssetPage'
import { ExportPage } from './pages/ExportPage'
import { DebugPage } from './pages/DebugPage'
import { AdminPage } from './pages/AdminPage'
import { ImportPage } from './pages/ImportPage'
import { JobGuard } from './components/JobGuard'

export default function App() {
  const route = useRoute()

  switch (route.name) {
    case 'home':
      return <HomePage />
    case 'debug':
      return <DebugPage />
    case 'import':
      return <ImportPage />
    case 'job':
      return (
        <JobGuard jobRef={route.jobRef}>
          <JobPage jobRef={route.jobRef} />
        </JobGuard>
      )
    case 'asset':
      return (
        <JobGuard jobRef={route.jobRef}>
          <AssetPage jobRef={route.jobRef} assetId={route.assetId} />
        </JobGuard>
      )
    case 'admin':
      return (
        <JobGuard jobRef={route.jobRef}>
          <AdminPage jobRef={route.jobRef} />
        </JobGuard>
      )
    case 'export':
      return (
        <JobGuard jobRef={route.jobRef}>
          <ExportPage jobRef={route.jobRef} />
        </JobGuard>
      )
  }
}
