import React, { useState, useEffect, useRef } from 'react'
import {
  UploadCloud,
  FileText,
  AlertCircle,
  Database,
  Shield,
  RefreshCw,
  Table as TableIcon,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Trash2,
  Building,
  Network,
  Lock,
  X,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Search,
} from 'lucide-react'

interface IngestStats {
  unique_senders?: number
  unique_receivers?: number
  total_volume?: number
}

interface TransactionRow {
  sender: string
  receiver: string
  amount: number
  timestamp: string
}

interface IngestResponse {
  status: string
  message: string
  filename: string
  rows_ingested: number
  columns: string[]
  detected_mapping?: Record<string, string>
  preview: TransactionRow[]
  stats?: IngestStats
}

interface PaginatedData {
  total_rows: number
  page: number
  limit: number
  total_pages: number
  data: TransactionRow[]
}

export interface SuspiciousAccount {
  account: string
  total_received: number
  total_sent: number
  total_volume: number
  transaction_count: number
  unique_senders: number
  unique_receivers: number
  wash_ratio: number
  risk_score: number
  risk_level: 'CRITICAL' | 'HIGH' | 'ELEVATED'
  flag_reasons: string[]
}

export interface GraphNode {
  id: string
  group: number
}

export interface GraphLink {
  source: string
  target: string
  amount: number
  timestamp: string
  hop: number
}

export interface LayerSummary {
  victim: number
  layer_1: number
  layer_2: number
  layer_3: number
}

export interface TraceResponse {
  status: string
  victim_id: string
  nodes: GraphNode[]
  links: GraphLink[]
  layer_summary: LayerSummary
  total_nodes: number
  total_links: number
  total_volume: number
  message?: string
}

export default function App() {
  // Backend & Connection status
  const [backendStatus, setBackendStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking')

  // Main navigation tab: 'suspicious' (default) vs 'all_data'
  const [activeTab, setActiveTab] = useState<'suspicious' | 'all_data'>('suspicious')

  // Upload modal/panel toggle
  const [showUpload, setShowUpload] = useState<boolean>(false)
  const [dragActive, setDragActive] = useState<boolean>(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState<boolean>(false)
  const [uploadProgress, setUploadProgress] = useState<number>(0)
  const [uploadStage, setUploadStage] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Ingestion metadata
  const [ingestMeta, setIngestMeta] = useState<IngestResponse | null>(null)

  // Suspicious Activity list state
  const [suspiciousList, setSuspiciousList] = useState<SuspiciousAccount[]>([])
  const [isLoadingSuspicious, setIsLoadingSuspicious] = useState<boolean>(false)
  const [suspiciousSearch, setSuspiciousSearch] = useState<string>('')

  // Paginated data grid state
  const [transactions, setTransactions] = useState<PaginatedData | null>(null)
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [pageSize] = useState<number>(50)
  const [isLoadingPage, setIsLoadingPage] = useState<boolean>(false)
  const [pageJumpInput, setPageJumpInput] = useState<string>('1')

  // Detailed Trace Report State
  const [activeTrackedId, setActiveTrackedId] = useState<string | null>(null)
  const [isTracing, setIsTracing] = useState<boolean>(false)
  const [traceError, setTraceError] = useState<string | null>(null)
  const [masterGraphData, setMasterGraphData] = useState<TraceResponse | null>(null)
  const [showTraceModal, setShowTraceModal] = useState<boolean>(false)

  // Accordion open/close state for layers in detailed report
  const [openLayers, setOpenLayers] = useState<{ [key: string]: boolean }>({
    victim: true,
    layer_1: true,
    layer_2: true,
    layer_3: true,
  })

  // Filter within detailed trace report
  const [traceFilterQuery, setTraceFilterQuery] = useState<string>('')

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fetch suspicious accounts from backend
  const fetchSuspiciousAccounts = async () => {
    setIsLoadingSuspicious(true)
    try {
      const res = await fetch('/api/suspicious?limit=100')
      if (res.ok) {
        const json = await res.json()
        setSuspiciousList(json.data || [])
      }
    } catch (err) {
      console.error('Failed to fetch suspicious accounts:', err)
    } finally {
      setIsLoadingSuspicious(false)
    }
  }

  // Fetch paginated transactions from backend
  const fetchPage = async (page: number) => {
    setIsLoadingPage(true)
    try {
      const res = await fetch(`/api/transactions?page=${page}&limit=${pageSize}`)
      if (res.ok) {
        const data: PaginatedData = await res.json()
        setTransactions(data)
        setCurrentPage(data.page)
        setPageJumpInput(data.page.toString())
      }
    } catch (err) {
      console.error('Failed to fetch transactions page:', err)
    } finally {
      setIsLoadingPage(false)
    }
  }

  // Initial startup verification
  const checkHealthAndSession = async () => {
    try {
      const res = await fetch('/api/health')
      if (res.ok) {
        setBackendStatus('connected')
        const statsRes = await fetch('/api/stats')
        if (statsRes.ok) {
          const stats = await statsRes.json()
          if (stats.transactions_loaded && stats.row_count > 0) {
            setIngestMeta({
              status: 'success',
              message: `Active session: ${stats.row_count.toLocaleString()} transactions loaded`,
              filename: 'fraud_data.duckdb (Persisted)',
              rows_ingested: stats.row_count,
              columns: ['sender', 'receiver', 'amount', 'timestamp'],
              preview: [],
              stats: stats.stats,
            })
            // Fetch both suspicious list (Default Tab) and page 1 of all data
            fetchSuspiciousAccounts()
            fetchPage(1)
          } else {
            setShowUpload(true)
          }
        }
      } else {
        setBackendStatus('disconnected')
        setShowUpload(true)
      }
    } catch {
      setBackendStatus('disconnected')
      setShowUpload(true)
    }
  }

  useEffect(() => {
    checkHealthAndSession()
  }, [])

  // Drag handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0]
      validateAndSetFile(file)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0])
    }
  }

  const validateAndSetFile = (file: File) => {
    setErrorMessage(null)
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setErrorMessage('Unsupported format. Please upload a valid .csv file.')
      setSelectedFile(null)
      return
    }
    setSelectedFile(file)
  }

  // Upload CSV to FastAPI backend
  const handleUpload = async () => {
    if (!selectedFile) return

    setIsUploading(true)
    setUploadProgress(15)
    setUploadStage('Reading file stream & preparing multipart payload...')
    setErrorMessage(null)

    const formData = new FormData()
    formData.append('file', selectedFile)

    try {
      setUploadProgress(40)
      setUploadStage('Transmitting to DuckDB Ingestion Engine...')

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      setUploadProgress(75)
      setUploadStage('DuckDB executing read_csv_auto() & indexing...')

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.detail || `Upload failed with status code ${response.status}`)
      }

      const data: IngestResponse = await response.json()
      setUploadProgress(100)
      setUploadStage('Ingestion complete!')

      setTimeout(() => {
        setIngestMeta(data)
        setIsUploading(false)
        setSelectedFile(null)
        setShowUpload(false)
        fetchSuspiciousAccounts()
        fetchPage(1)
      }, 400)
    } catch (err: unknown) {
      setIsUploading(false)
      setUploadProgress(0)
      setErrorMessage(err instanceof Error ? err.message : 'An unexpected error occurred during ingestion.')
    }
  }

  // Track Action Trigger (Calls GET /api/trace/{id} and opens detailed report)
  const handleTrackAccount = async (accountId: string) => {
    const cleanId = accountId.trim()
    if (!cleanId) return

    setActiveTrackedId(cleanId)
    setIsTracing(true)
    setTraceError(null)
    setShowTraceModal(true)

    try {
      const res = await fetch(`/api/trace/${encodeURIComponent(cleanId)}`)
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson.detail || `Trace request failed with status ${res.status}`)
      }

      const data: TraceResponse = await res.json()
      setMasterGraphData(data)
    } catch (err: unknown) {
      setTraceError(err instanceof Error ? err.message : 'Failed to execute recursive network trace.')
      setMasterGraphData(null)
    } finally {
      setIsTracing(false)
    }
  }

  // Quick Load Simulation Dataset (11 rows)
  const handleLoadSample = () => {
    const sampleCsv = `sender,receiver,amount,timestamp
VICTIM_001,MULE_101,250000.00,2026-03-01 09:15:00
VICTIM_001,MULE_102,175000.00,2026-03-01 09:22:00
MULE_101,MULE_201,120000.00,2026-03-01 10:05:00
MULE_101,MULE_202,125000.00,2026-03-01 10:18:00
MULE_102,MULE_202,80000.00,2026-03-01 10:45:00
MULE_102,MULE_203,90000.00,2026-03-01 11:12:00
MULE_201,EXIT_NODE_901,118000.00,2026-03-01 12:30:00
MULE_202,CRYPTO_GATEWAY_902,200000.00,2026-03-01 13:00:00
MULE_203,HAWALA_CORP_903,88000.00,2026-03-01 14:10:00
REGULAR_USER_A,REGULAR_USER_B,1500.00,2026-03-01 08:30:00
REGULAR_USER_C,REGULAR_USER_D,4500.00,2026-03-01 15:45:00`
    const blob = new Blob([sampleCsv], { type: 'text/csv' })
    const file = new File([blob], 'sample_fraud_network.csv', { type: 'text/csv' })
    validateAndSetFile(file)
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  const handlePageJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!transactions) return
    const target = parseInt(pageJumpInput, 10)
    if (!isNaN(target) && target >= 1 && target <= transactions.total_pages) {
      fetchPage(target)
    } else {
      setPageJumpInput(currentPage.toString())
    }
  }

  const toggleLayer = (layerKey: string) => {
    setOpenLayers((prev) => ({ ...prev, [layerKey]: !prev[layerKey] }))
  }

  // Filtered links inside the Detailed Report
  const filteredLinks = masterGraphData?.links.filter((l) => {
    if (!traceFilterQuery.trim()) return true
    const q = traceFilterQuery.toLowerCase()
    return (
      l.source.toLowerCase().includes(q) ||
      l.target.toLowerCase().includes(q) ||
      l.amount.toString().includes(q)
    )
  }) || []

  // Grouped links by layer
  const layer1Links = filteredLinks.filter((l) => l.hop === 1)
  const layer2Links = filteredLinks.filter((l) => l.hop === 2)
  const layer3Links = filteredLinks.filter((l) => l.hop === 3)

  const layer1Total = layer1Links.reduce((acc, curr) => acc + curr.amount, 0)
  const layer2Total = layer2Links.reduce((acc, curr) => acc + curr.amount, 0)
  const layer3Total = layer3Links.reduce((acc, curr) => acc + curr.amount, 0)

  // Filtered suspicious accounts list
  const filteredSuspicious = suspiciousList.filter((item) => {
    if (!suspiciousSearch.trim()) return true
    const q = suspiciousSearch.toLowerCase()
    return (
      item.account.toLowerCase().includes(q) ||
      item.risk_level.toLowerCase().includes(q) ||
      item.flag_reasons.some((r) => r.toLowerCase().includes(q))
    )
  })

  const totalRows = transactions?.total_rows ?? ingestMeta?.rows_ingested ?? 0
  const startRow = totalRows > 0 ? (currentPage - 1) * pageSize + 1 : 0
  const endRow = totalRows > 0 ? Math.min(currentPage * pageSize, totalRows) : 0

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Enterprise Corporate Header */}
      <header className="border-b border-slate-200 bg-white sticky top-0 z-50 px-6 py-3.5 shadow-xs">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3.5">
            <div className="h-10 w-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-sm">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-base font-bold text-slate-900 tracking-tight">
                  Financial Fraud Network Tracer
                </h1>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 font-mono">
                  Detect First &bull; Trace Second
                </span>
              </div>
              <p className="text-xs text-slate-500">Autonomous Mule Hub Flagging & Multi-Hop Forensics</p>
            </div>
          </div>

          {/* Engine Health Indicator */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-xs text-slate-700 font-medium">
              <Database className="h-3.5 w-3.5 text-indigo-600" />
              <span>DuckDB OLAP:</span>
              {backendStatus === 'connected' ? (
                <span className="flex items-center gap-1.5 text-emerald-700 font-semibold">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  Ready (2M+ Rows Indexed)
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-rose-600 font-semibold">
                  <span className="h-2 w-2 rounded-full bg-rose-500"></span>
                  Offline
                </span>
              )}
            </div>
            <button
              onClick={checkHealthAndSession}
              className="p-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition-colors shadow-xs"
              title="Refresh engine state"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6 flex flex-col gap-6">
        {/* Forensic Pipeline Stepper Header */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 mb-3">
            <span className="text-slate-900 font-semibold flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-indigo-600"></span>
              Investigation Pipeline
            </span>
            <span className="font-mono text-indigo-600 font-semibold">Phase 2: Detect First &bull; Track Second</span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div className="h-1.5 rounded-full bg-emerald-600"></div>
            <div className="h-1.5 rounded-full bg-indigo-600"></div>
            <div className="h-1.5 rounded-full bg-slate-200"></div>
            <div className="h-1.5 rounded-full bg-slate-200"></div>
          </div>
          <div className="grid grid-cols-4 gap-2 mt-2 text-[11px] font-medium text-slate-500">
            <span className="text-emerald-700 font-semibold">&check; 1. Ingestion & Indexing</span>
            <span className="text-indigo-600 font-semibold">2. Auto-Detect & 3-Hop Tracing</span>
            <span className="text-slate-400">3. WebGL Graph & Time-Travel</span>
            <span className="text-slate-400">4. Sec 91 Legal Action</span>
          </div>
        </div>

        {/* SECTION 1: UPLOAD MODAL/PANEL (IF TOGGLED OR NO DATA) */}
        {(showUpload || !transactions || transactions.total_rows === 0) && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 md:p-8 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <UploadCloud className="h-5 w-5 text-indigo-600" />
                  Transaction Journal Ingestion
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Load raw financial transaction journals directly into DuckDB's in-memory columnar database.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono font-medium text-slate-600 bg-slate-100 px-2.5 py-1 rounded border border-slate-200">
                  DuckDB read_csv_auto()
                </span>
                {transactions && transactions.total_rows > 0 && (
                  <button
                    onClick={() => setShowUpload(false)}
                    className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                    title="Close upload panel"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Drag & Drop Zone */}
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 md:p-12 text-center cursor-pointer transition-all duration-150 ${
                dragActive
                  ? 'border-indigo-600 bg-indigo-50/50'
                  : selectedFile
                  ? 'border-emerald-500 bg-emerald-50/30'
                  : 'border-slate-300 hover:border-indigo-400 bg-slate-50/50 hover:bg-slate-50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="hidden"
              />

              {!selectedFile ? (
                <div className="flex flex-col items-center justify-center space-y-3">
                  <div className="h-12 w-12 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                    <UploadCloud className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      Drop transaction CSV file here, or{' '}
                      <span className="text-indigo-600 underline underline-offset-2">browse computer</span>
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      Supported schema: <code className="text-slate-700 bg-slate-200/60 px-1 py-0.5 rounded">sender</code>, <code className="text-slate-700 bg-slate-200/60 px-1 py-0.5 rounded">receiver</code>, <code className="text-slate-700 bg-slate-200/60 px-1 py-0.5 rounded">amount</code>, <code className="text-slate-700 bg-slate-200/60 px-1 py-0.5 rounded">timestamp</code> (auto-standardized)
                    </p>
                  </div>
                  <div className="flex items-center gap-2 pt-1 text-[11px] text-slate-500">
                    <span className="px-2 py-0.5 rounded bg-white border border-slate-200">Automatic Schema Mapping</span>
                    <span className="px-2 py-0.5 rounded bg-white border border-slate-200">Handles 2M+ Rows in Seconds</span>
                  </div>

                  <div className="pt-3">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleLoadSample()
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-indigo-700 text-xs font-semibold border border-indigo-200 transition shadow-xs"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                      Load Simulation Dataset (11 Multi-Hop Records)
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center space-y-2.5">
                  <div className="h-12 w-12 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                    <FileText className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900 font-mono">{selectedFile.name}</p>
                    <p className="text-xs text-slate-500">
                      File Size: {formatFileSize(selectedFile.size)} &bull; Ready for DuckDB Ingestion
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedFile(null)
                    }}
                    className="inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700 font-medium transition"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove file
                  </button>
                </div>
              )}
            </div>

            {/* Error Message */}
            {errorMessage && (
              <div className="mt-4 p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2.5">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Ingestion Loading Bar */}
            {isUploading && (
              <div className="mt-5 p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-700 font-medium flex items-center gap-2">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-indigo-600" />
                    {uploadStage}
                  </span>
                  <span className="font-mono text-indigo-600 font-bold">{uploadProgress}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 transition-all duration-300 ease-out"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Ingestion Action Button */}
            {selectedFile && !isUploading && (
              <div className="mt-5 flex items-center justify-end gap-3">
                <button
                  onClick={() => setSelectedFile(null)}
                  className="px-4 py-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpload}
                  className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs flex items-center gap-2 transition"
                >
                  <Database className="h-3.5 w-3.5" />
                  Ingest into DuckDB Engine
                </button>
              </div>
            )}
          </div>
        )}

        {/* SECTION 2: EXECUTIVE SPLIT VIEW TABS (SUSPICIOUS ACTIVITY vs. ALL DATA) */}
        {transactions && transactions.total_rows > 0 && (
          <div className="flex flex-col gap-4">
            {/* Tab Switcher & Quick Upload Bar */}
            <div className="flex items-center justify-between flex-wrap gap-3 bg-white p-2.5 rounded-xl border border-slate-200 shadow-xs">
              <div className="flex items-center gap-2">
                {/* Tab 2: Suspicious Activity (DEFAULT) */}
                <button
                  onClick={() => setActiveTab('suspicious')}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition ${
                    activeTab === 'suspicious'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <AlertTriangle className="h-4 w-4 text-amber-300" />
                  <span>Suspicious Activity (Flagged Hubs)</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
                      activeTab === 'suspicious'
                        ? 'bg-indigo-700 text-indigo-100'
                        : 'bg-rose-50 text-rose-700 border border-rose-200'
                    }`}
                  >
                    {suspiciousList.length} Flagged
                  </span>
                </button>

                {/* Tab 1: All Data Grid */}
                <button
                  onClick={() => setActiveTab('all_data')}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition ${
                    activeTab === 'all_data'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <TableIcon className="h-4 w-4" />
                  <span>All Data Grid</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
                      activeTab === 'all_data'
                        ? 'bg-indigo-700 text-indigo-100'
                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}
                  >
                    {totalRows.toLocaleString()} Rows
                  </span>
                </button>
              </div>

              {/* Upload New File Button */}
              <button
                onClick={() => setShowUpload(!showUpload)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-medium transition"
              >
                <UploadCloud className="h-3.5 w-3.5 text-indigo-600" />
                <span>{showUpload ? 'Hide Upload' : 'Upload Another CSV'}</span>
              </button>
            </div>

            {/* TAB CONTENT 1: SUSPICIOUS ACTIVITY LIST (DEFAULT ACTIVE TAB) */}
            {activeTab === 'suspicious' && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between flex-wrap gap-3 bg-slate-50/70">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-rose-600" />
                      Auto-Detected Suspicious Accounts & Money Mules
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Flagged by DuckDB heuristic analytics: High multi-sender fan-in, layering dispersal, and extreme velocity.
                    </p>
                  </div>

                  {/* Search inside Suspicious Accounts */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Filter flagged accounts..."
                      value={suspiciousSearch}
                      onChange={(e) => setSuspiciousSearch(e.target.value)}
                      className="bg-white border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-900 font-mono focus:outline-indigo-500 w-56"
                    />
                  </div>
                </div>

                {isLoadingSuspicious ? (
                  <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center">
                    <RefreshCw className="h-6 w-6 animate-spin text-indigo-600 mb-2" />
                    <p className="text-xs font-medium">Scanning 2M+ records for anomalous wash patterns...</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100/90 text-slate-600 font-semibold border-b border-slate-200 uppercase text-[10px] tracking-wider">
                        <tr>
                          <th className="px-4 py-3 w-12 text-center text-slate-400">#</th>
                          <th className="px-4 py-3">Flagged Account</th>
                          <th className="px-4 py-3">Risk Assessment</th>
                          <th className="px-4 py-3 text-right">Inflow Volume</th>
                          <th className="px-4 py-3 text-right">Outflow Volume</th>
                          <th className="px-4 py-3 text-center">Fan-In / Fan-Out</th>
                          <th className="px-4 py-3">Heuristic Anomalies</th>
                          <th className="px-4 py-3 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700 font-mono">
                        {filteredSuspicious.map((item, idx) => (
                          <tr key={idx} className="hover:bg-rose-50/20 transition-colors">
                            <td className="px-4 py-3 text-center text-slate-400 font-sans text-[11px]">
                              {idx + 1}
                            </td>
                            <td className="px-4 py-3 font-bold text-slate-900">
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-900">
                                {item.account}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                                  item.risk_level === 'CRITICAL'
                                    ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                    : item.risk_level === 'HIGH'
                                    ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                    : 'bg-blue-100 text-blue-800 border border-blue-200'
                                }`}
                              >
                                {item.risk_level} {item.risk_score}%
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-emerald-700">
                              ${item.total_received.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-rose-700">
                              ${item.total_sent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-4 py-3 text-center text-[11px] text-slate-600">
                              <span className="font-semibold text-indigo-700">{item.unique_senders}</span> in &rarr;{' '}
                              <span className="font-semibold text-rose-700">{item.unique_receivers}</span> out
                            </td>
                            <td className="px-4 py-3 font-sans">
                              <div className="flex flex-wrap gap-1 max-w-xs">
                                {item.flag_reasons.map((r, rIdx) => (
                                  <span
                                    key={rIdx}
                                    className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-[10px] text-slate-600"
                                  >
                                    {r}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <button
                                type="button"
                                onClick={() => handleTrackAccount(item.account)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-sans text-xs font-bold shadow-xs transition active:scale-95"
                              >
                                <Network className="h-3.5 w-3.5" />
                                <span>Track</span>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* TAB CONTENT 2: ALL DATA GRID LEDGER (PAGINATED) */}
            {activeTab === 'all_data' && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
                <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2 bg-slate-50/60">
                  <div className="flex items-center gap-2">
                    <TableIcon className="h-4 w-4 text-indigo-600" />
                    <span className="text-xs font-bold text-slate-800">
                      Transaction Forensics Ledger
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono bg-white px-2 py-0.5 rounded border border-slate-200">
                      Page {currentPage} of {transactions.total_pages.toLocaleString()}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {isLoadingPage && (
                      <span className="flex items-center gap-1.5 text-xs text-indigo-600 font-medium">
                        <RefreshCw className="h-3 w-3 animate-spin" />
                        Loading page {currentPage}...
                      </span>
                    )}
                  </div>
                </div>

                {/* Data Table */}
                <div className="overflow-x-auto min-h-[300px]">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100/80 text-slate-600 font-semibold border-b border-slate-200 uppercase text-[10px] tracking-wider">
                      <tr>
                        <th className="px-4 py-2.5 w-16 text-center text-slate-400">#</th>
                        <th className="px-4 py-2.5">Sender (Origin Account)</th>
                        <th className="px-4 py-2.5">Receiver (Target Account)</th>
                        <th className="px-4 py-2.5 text-right">Amount (USD)</th>
                        <th className="px-4 py-2.5">Timestamp</th>
                        <th className="px-4 py-2.5 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700 font-mono">
                      {transactions.data.map((row, idx) => {
                        const rowNumber = (currentPage - 1) * pageSize + idx + 1
                        return (
                          <tr key={idx} className="hover:bg-indigo-50/40 transition-colors">
                            <td className="px-4 py-2.5 text-center text-slate-400 font-sans text-[11px]">
                              {rowNumber.toLocaleString()}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-800 font-medium border border-slate-200">
                                {row.sender || <span className="text-slate-400 italic">N/A</span>}
                              </span>
                            </td>
                            <td className="px-4 py-2.5">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-800 font-medium border border-slate-200">
                                {row.receiver || <span className="text-slate-400 italic">N/A</span>}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right font-semibold text-emerald-700">
                              ${row.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-4 py-2.5 text-slate-500 text-[11px]">
                              {row.timestamp}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <button
                                type="button"
                                onClick={() => handleTrackAccount(row.sender)}
                                className="px-2.5 py-1 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-sans font-semibold transition"
                              >
                                Track
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/70 flex items-center justify-between flex-wrap gap-4 text-xs">
                  <div className="text-slate-600 font-medium">
                    Showing <span className="font-semibold text-slate-900">{startRow.toLocaleString()}</span> to{' '}
                    <span className="font-semibold text-slate-900">{endRow.toLocaleString()}</span> of{' '}
                    <span className="font-bold text-slate-900">{totalRows.toLocaleString()}</span> records
                  </div>

                  <form onSubmit={handlePageJumpSubmit} className="flex items-center gap-2">
                    <span className="text-slate-500">Go to page:</span>
                    <input
                      type="number"
                      min={1}
                      max={transactions.total_pages}
                      value={pageJumpInput}
                      onChange={(e) => setPageJumpInput(e.target.value)}
                      className="w-16 px-2 py-1 bg-white border border-slate-300 rounded text-center text-slate-800 font-mono text-xs focus:outline-indigo-500"
                    />
                    <span className="text-slate-400">/ {transactions.total_pages.toLocaleString()}</span>
                    <button
                      type="submit"
                      className="px-2.5 py-1 rounded bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium text-xs shadow-xs"
                    >
                      Go
                    </button>
                  </form>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => fetchPage(currentPage - 1)}
                      disabled={currentPage <= 1 || isLoadingPage}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium shadow-xs disabled:opacity-40 disabled:cursor-not-allowed transition"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </button>
                    <button
                      onClick={() => fetchPage(currentPage + 1)}
                      disabled={currentPage >= transactions.total_pages || isLoadingPage}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium shadow-xs disabled:opacity-40 disabled:cursor-not-allowed transition"
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SECTION 3: COMPREHENSIVE DETAILED LAYER-BY-LAYER TRACE REPORT (OVERHAUL) */}
        {showTraceModal && (
          <div className="bg-white rounded-2xl border-2 border-indigo-500/20 shadow-xl p-6 md:p-8 flex flex-col gap-6 scroll-mt-6">
            {/* Report Header */}
            <div className="flex items-start justify-between flex-wrap gap-4 pb-5 border-b border-slate-200">
              <div className="flex items-start gap-3.5">
                <div className="h-11 w-11 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 shrink-0">
                  <Network className="h-6 w-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200 font-mono">
                      Detailed Trace Report
                    </span>
                    <span className="text-xs font-mono font-bold text-slate-900 bg-slate-100 px-2.5 py-0.5 rounded border border-slate-200">
                      Target: {activeTrackedId}
                    </span>
                  </div>
                  <h2 className="text-lg font-extrabold text-slate-900 mt-1">
                    Multi-Hop Money Laundering Trail Forensics
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Categorized breakdown of all downstream connections discovered by Recursive DuckDB CTE.
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2.5">
                <button
                  disabled
                  className="px-4 py-2 rounded-lg bg-slate-100 text-slate-400 text-xs font-bold cursor-not-allowed border border-slate-200 flex items-center gap-2 shadow-xs"
                >
                  <Lock className="h-3.5 w-3.5 text-slate-400" />
                  <span>Proceed to Visual Graph (Phase 3)</span>
                </button>
                <button
                  onClick={() => setShowTraceModal(false)}
                  className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 transition"
                  title="Close Trace Report"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Error or Loading State */}
            {isTracing && (
              <div className="p-12 text-center text-slate-600 flex flex-col items-center justify-center">
                <RefreshCw className="h-8 w-8 animate-spin text-indigo-600 mb-3" />
                <h3 className="text-sm font-bold text-slate-900">Executing Recursive 3-Hop Traversal...</h3>
                <p className="text-xs text-slate-500 mt-1">Traversing millions of relations in DuckDB with cycle prevention...</p>
              </div>
            )}

            {traceError && (
              <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2.5">
                <AlertCircle className="h-5 w-5 shrink-0 text-rose-600" />
                <span>{traceError}</span>
              </div>
            )}

            {/* Complete Report Details */}
            {masterGraphData && !isTracing && (
              <div className="flex flex-col gap-6">
                {/* 4 Executive Metric Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">
                      Total Discovered Entities
                    </span>
                    <p className="text-2xl font-extrabold text-slate-900 font-mono mt-1">
                      {masterGraphData.total_nodes} Accounts
                    </p>
                    <span className="text-[10px] text-indigo-600 font-medium">In Master State</span>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">
                      Total Links Traversed
                    </span>
                    <p className="text-2xl font-extrabold text-indigo-600 font-mono mt-1">
                      {masterGraphData.total_links} Transfers
                    </p>
                    <span className="text-[10px] text-slate-500 font-medium">100% Displayed Below</span>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">
                      Total Layered Volume
                    </span>
                    <p className="text-2xl font-extrabold text-emerald-700 font-mono mt-1">
                      ${masterGraphData.total_volume.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <span className="text-[10px] text-slate-500 font-medium">Cumulative Money Trail</span>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                    <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider block">
                      Max Hop Depth
                    </span>
                    <p className="text-2xl font-extrabold text-slate-900 font-mono mt-1">
                      3 Layers
                    </p>
                    <span className="text-[10px] text-emerald-700 font-medium">Zero-Cycle Loop Safety</span>
                  </div>
                </div>

                {/* Filter within Detailed Report */}
                <div className="flex items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
                  <div className="flex items-center gap-2">
                    <Search className="h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search within report links (account, amount)..."
                      value={traceFilterQuery}
                      onChange={(e) => setTraceFilterQuery(e.target.value)}
                      className="bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-900 font-mono focus:outline-indigo-500 w-72"
                    />
                  </div>
                  <span className="text-xs text-slate-500 font-mono">
                    Showing {filteredLinks.length} of {masterGraphData.total_links} total links
                  </span>
                </div>

                {/* SECTION 1: THE VICTIM (HOP 0) */}
                <div className="rounded-xl border border-emerald-200 bg-white overflow-hidden shadow-xs">
                  <div
                    onClick={() => toggleLayer('victim')}
                    className="p-4 bg-emerald-50/60 border-b border-emerald-100 flex items-center justify-between cursor-pointer hover:bg-emerald-50 transition"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="h-3 w-3 rounded-full bg-emerald-500"></span>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-950">
                        Section 1: Starting Account (Hop 0 - Source of Funds)
                      </h3>
                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-mono font-bold">
                        1 Account
                      </span>
                    </div>
                    {openLayers.victim ? <ChevronUp className="h-4 w-4 text-emerald-700" /> : <ChevronDown className="h-4 w-4 text-emerald-700" />}
                  </div>

                  {openLayers.victim && (
                    <div className="p-4 bg-emerald-50/20">
                      <div className="flex items-center justify-between p-3.5 rounded-lg bg-white border border-emerald-200/80">
                        <div>
                          <span className="text-[11px] font-mono text-slate-500 uppercase">Target Investigated ID:</span>
                          <p className="text-base font-bold font-mono text-slate-900 mt-0.5">{masterGraphData.victim_id}</p>
                        </div>
                        <div className="text-right">
                          <span className="text-[11px] font-mono text-slate-500 uppercase">Immediate Layer 1 Outflow:</span>
                          <p className="text-sm font-bold font-mono text-emerald-700 mt-0.5">
                            ${layer1Total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* SECTION 2: LAYER 1 (MULES) */}
                <div className="rounded-xl border border-amber-200 bg-white overflow-hidden shadow-xs">
                  <div
                    onClick={() => toggleLayer('layer_1')}
                    className="p-4 bg-amber-50/60 border-b border-amber-100 flex items-center justify-between cursor-pointer hover:bg-amber-50 transition"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="h-3 w-3 rounded-full bg-amber-400"></span>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-amber-950">
                        Section 2: Layer 1 (Primary Money Mules)
                      </h3>
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-mono font-bold">
                        {layer1Links.length} Transfers &bull; ${layer1Total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    {openLayers.layer_1 ? <ChevronUp className="h-4 w-4 text-amber-700" /> : <ChevronDown className="h-4 w-4 text-amber-700" />}
                  </div>

                  {openLayers.layer_1 && (
                    <div className="p-3 bg-amber-50/10 max-h-80 overflow-y-auto">
                      <table className="w-full text-left text-xs font-mono">
                        <thead className="bg-amber-50/50 text-amber-900 uppercase text-[10px] tracking-wider border-b border-amber-200">
                          <tr>
                            <th className="px-3.5 py-2">Source (Origin)</th>
                            <th className="px-3.5 py-2">Target (Primary Mule)</th>
                            <th className="px-3.5 py-2 text-right">Amount (USD)</th>
                            <th className="px-3.5 py-2">Timestamp</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-amber-100 text-slate-700">
                          {layer1Links.map((l, idx) => (
                            <tr key={idx} className="hover:bg-amber-50/40 transition">
                              <td className="px-3.5 py-2 text-slate-900 font-semibold">{l.source}</td>
                              <td className="px-3.5 py-2 text-amber-900 font-bold flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-full bg-amber-400"></span>
                                {l.target}
                              </td>
                              <td className="px-3.5 py-2 text-right font-bold text-emerald-700">
                                ${l.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td className="px-3.5 py-2 text-slate-500 text-[11px]">{l.timestamp}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* SECTION 3: LAYER 2 (DISTRIBUTORS / SMURFING) */}
                <div className="rounded-xl border border-orange-200 bg-white overflow-hidden shadow-xs">
                  <div
                    onClick={() => toggleLayer('layer_2')}
                    className="p-4 bg-orange-50/60 border-b border-orange-100 flex items-center justify-between cursor-pointer hover:bg-orange-50 transition"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="h-3 w-3 rounded-full bg-orange-500"></span>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-orange-950">
                        Section 3: Layer 2 (Distributors & Intermediate Smurfs)
                      </h3>
                      <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 text-[11px] font-mono font-bold">
                        {layer2Links.length} Transfers &bull; ${layer2Total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    {openLayers.layer_2 ? <ChevronUp className="h-4 w-4 text-orange-700" /> : <ChevronDown className="h-4 w-4 text-orange-700" />}
                  </div>

                  {openLayers.layer_2 && (
                    <div className="p-3 bg-orange-50/10 max-h-96 overflow-y-auto">
                      <table className="w-full text-left text-xs font-mono">
                        <thead className="bg-orange-50/50 text-orange-900 uppercase text-[10px] tracking-wider border-b border-orange-200">
                          <tr>
                            <th className="px-3.5 py-2">Source (Layer 1 Mule)</th>
                            <th className="px-3.5 py-2">Target (Layer 2 Distributor)</th>
                            <th className="px-3.5 py-2 text-right">Amount (USD)</th>
                            <th className="px-3.5 py-2">Timestamp</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-orange-100 text-slate-700">
                          {layer2Links.map((l, idx) => (
                            <tr key={idx} className="hover:bg-orange-50/40 transition">
                              <td className="px-3.5 py-2 text-slate-800 font-semibold">{l.source}</td>
                              <td className="px-3.5 py-2 text-orange-900 font-bold flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-full bg-orange-500"></span>
                                {l.target}
                              </td>
                              <td className="px-3.5 py-2 text-right font-bold text-emerald-700">
                                ${l.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td className="px-3.5 py-2 text-slate-500 text-[11px]">{l.timestamp}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* SECTION 4: LAYER 3 (TERMINAL / CASHOUT ENDPOINTS) */}
                <div className="rounded-xl border border-rose-200 bg-white overflow-hidden shadow-xs">
                  <div
                    onClick={() => toggleLayer('layer_3')}
                    className="p-4 bg-rose-50/60 border-b border-rose-100 flex items-center justify-between cursor-pointer hover:bg-rose-50 transition"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="h-3 w-3 rounded-full bg-rose-500"></span>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-rose-950">
                        Section 4: Layer 3 (Terminal Cashout & Exit Nodes)
                      </h3>
                      <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-[11px] font-mono font-bold">
                        {layer3Links.length} Transfers &bull; ${layer3Total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    {openLayers.layer_3 ? <ChevronUp className="h-4 w-4 text-rose-700" /> : <ChevronDown className="h-4 w-4 text-rose-700" />}
                  </div>

                  {openLayers.layer_3 && (
                    <div className="p-3 bg-rose-50/10 max-h-96 overflow-y-auto">
                      <table className="w-full text-left text-xs font-mono">
                        <thead className="bg-rose-50/50 text-rose-900 uppercase text-[10px] tracking-wider border-b border-rose-200">
                          <tr>
                            <th className="px-3.5 py-2">Source (Layer 2)</th>
                            <th className="px-3.5 py-2">Terminal Target (Sec 91 Freeze Candidate)</th>
                            <th className="px-3.5 py-2 text-right">Amount (USD)</th>
                            <th className="px-3.5 py-2">Timestamp</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-rose-100 text-slate-700">
                          {layer3Links.map((l, idx) => (
                            <tr key={idx} className="hover:bg-rose-50/40 transition">
                              <td className="px-3.5 py-2 text-slate-800 font-semibold">{l.source}</td>
                              <td className="px-3.5 py-2 text-rose-900 font-bold flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-full bg-rose-500"></span>
                                {l.target}
                              </td>
                              <td className="px-3.5 py-2 text-right font-bold text-emerald-700">
                                ${l.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td className="px-3.5 py-2 text-slate-500 text-[11px]">{l.timestamp}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Enterprise Footer */}
      <footer className="border-t border-slate-200 bg-white px-6 py-3.5 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-medium text-slate-600">
            <Building className="h-3.5 w-3.5 text-indigo-600" />
            Financial Fraud Network Tracer &bull; Enterprise Compliance & Forensics
          </span>
          <span className="font-mono text-[11px] text-slate-500">
            FastAPI &bull; DuckDB Auto-Detection & Recursive CTE &bull; React 19 &bull; Tailwind CSS
          </span>
        </div>
      </footer>
    </div>
  )
}
