import React, { useState, useEffect, useRef } from 'react'
import Papa from 'papaparse'
import {
  UploadCloud,
  AlertCircle,
  Database,
  Shield,
  RefreshCw,
  Table as TableIcon,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Building,
  Network,
  Lock,
  X,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Search,
  Smartphone,
  Globe,
  Clock,
  Activity,
  ArrowLeft,
  Copy,
  Check,
  Zap,
  CheckCircle2,
} from 'lucide-react'

// --- Interfaces & Types ---

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
  ip_address?: string
  device_type?: string
  payment_mode?: string
  narration?: string
}

interface IngestResponse {
  status: string
  message: string
  filename: string
  rows_ingested: number
  elapsed_sec?: number
  columns: string[]
  preview?: TransactionRow[]
  stats?: IngestStats
}

interface PaginatedTransactions {
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
  risk_factors: string[]
  primary_device?: string
  primary_ip?: string
}

interface PaginatedSuspicious {
  total_rows: number
  page: number
  limit: number
  total_pages: number
  data: SuspiciousAccount[]
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
  ip_address?: string
  device_type?: string
  payment_mode?: string
  narration?: string
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

type SelectedEntity =
  | { type: 'suspicious'; data: SuspiciousAccount }
  | { type: 'transaction'; data: TransactionRow }
  | null

// Helper to normalize CSV headers dynamically across different bank formats
function normalizeRow(raw: Record<string, any>): TransactionRow {
  let sender = ''
  let receiver = ''
  let amount = 0
  let timestamp = ''
  let ip_address = ''
  let device_type = ''
  let payment_mode = ''
  let narration = ''

  for (const [rawKey, val] of Object.entries(raw)) {
    if (!rawKey || val === undefined || val === null) continue
    const norm = rawKey.toLowerCase().replace(/[^a-z0-9]/g, '')
    const strVal = String(val).trim()

    // Sender Account (From / Remitter / Debit)
    if (!sender && (/^(sender|from|remitter|originator|payer|debitaccount|draccount|sourceaccount)/.test(norm) || ['sender', 'from', 'remitter', 'payer'].some(k => norm.includes(k)))) {
      sender = strVal
      continue
    }

    // Receiver Account (To / Beneficiary / Credit)
    if (!receiver && (/^(receiver|to|beneficiary|payee|dest|target|creditaccount|craccount)/.test(norm) || ['receiver', 'beneficiary', 'payee'].some(k => norm.includes(k)))) {
      receiver = strVal
      continue
    }

    // Amount
    if (!amount && ['amount', 'amt', 'volume', 'value', 'txnamt', 'inr', 'usd'].some(k => norm.includes(k))) {
      amount = parseFloat(strVal.replace(/[^0-9.-]/g, '')) || 0
      continue
    }

    // Timestamp / Date
    if (!timestamp && ['timestamp', 'datetime', 'txndate', 'time', 'date'].some(k => norm.includes(k))) {
      timestamp = strVal
      continue
    }

    // IP Address
    if (!ip_address && (norm === 'ip' || norm.startsWith('ip') || norm.includes('ipaddr') || norm.includes('clientip'))) {
      ip_address = strVal
      continue
    }

    // Device Type
    if (!device_type && ['device', 'mac', 'useragent', 'browser', 'os', 'hardware'].some(k => norm.includes(k))) {
      device_type = strVal
      continue
    }

    // Payment Mode
    if (!payment_mode && ['mode', 'channel', 'method', 'paymentmode', 'txnmode'].some(k => norm.includes(k))) {
      payment_mode = strVal
      continue
    }

    // Narration
    if (!narration && ['narration', 'desc', 'remark', 'memo', 'purpose', 'comment', 'note', 'particulars'].some(k => norm.includes(k))) {
      narration = strVal
      continue
    }
  }

  return {
    sender,
    receiver,
    amount,
    timestamp,
    ip_address,
    device_type,
    payment_mode,
    narration,
  }
}

export default function App() {
  // Backend & Connection status
  const [backendStatus, setBackendStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking')

  // Main navigation tab: 'suspicious' vs 'all_data' (defaults to 'all_data' upon new file stream, else 'suspicious')
  const [activeTab, setActiveTab] = useState<'suspicious' | 'all_data'>('suspicious')

  // Upload modal/panel toggle
  const [showUpload, setShowUpload] = useState<boolean>(false)
  const [dragActive, setDragActive] = useState<boolean>(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Ingestion metadata
  const [ingestMeta, setIngestMeta] = useState<IngestResponse | null>(null)

  // Zero-Wait Optimistic Background Loading States
  const [bgIngestStatus, setBgIngestStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle')
  const [bgIngestMessage, setBgIngestMessage] = useState<string>('')
  const [isLocalMode, setIsLocalMode] = useState<boolean>(false)
  const [localBuffer, setLocalBuffer] = useState<TransactionRow[]>([])

  // Clear Space Confirmation Modal
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false)
  const [isClearingSpace, setIsClearingSpace] = useState<boolean>(false)

  // Suspicious Activity list state (Paginated)
  const [suspiciousData, setSuspiciousData] = useState<PaginatedSuspicious | null>(null)
  const [suspiciousPage, setSuspiciousPage] = useState<number>(1)
  const [suspiciousPageSize] = useState<number>(50)
  const [suspiciousPageJumpInput, setSuspiciousPageJumpInput] = useState<string>('1')
  const [isLoadingSuspicious, setIsLoadingSuspicious] = useState<boolean>(false)
  const [suspiciousSearch, setSuspiciousSearch] = useState<string>('')

  // Paginated all transactions state
  const [transactions, setTransactions] = useState<PaginatedTransactions | null>(null)
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [pageSize] = useState<number>(100) // 100 rows per page as per mentor specification
  const [isLoadingPage, setIsLoadingPage] = useState<boolean>(false)
  const [pageJumpInput, setPageJumpInput] = useState<string>('1')

  // Step 5: Row Click Detailed View (Entity Selection)
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntity>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Detailed Trace Report State
  const [activeTrackedId, setActiveTrackedId] = useState<string | null>(null)
  const [isTracing, setIsTracing] = useState<boolean>(false)
  const [traceError, setTraceError] = useState<string | null>(null)
  const [masterGraphData, setMasterGraphData] = useState<TraceResponse | null>(null)
  const [showTraceModal, setShowTraceModal] = useState<boolean>(false)

  // Accordion open/close state for layers in detailed trace report
  const [openLayers, setOpenLayers] = useState<{ [key: string]: boolean }>({
    victim: true,
    layer_1: true,
    layer_2: true,
    layer_3: true,
  })

  // Filter within detailed trace report
  const [traceFilterQuery, setTraceFilterQuery] = useState<string>('')

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fetch suspicious accounts with pagination & search
  const fetchSuspiciousAccounts = async (page: number = 1, search: string = suspiciousSearch) => {
    setIsLoadingSuspicious(true)
    try {
      const queryParams = new URLSearchParams({
        page: page.toString(),
        limit: suspiciousPageSize.toString(),
      })
      if (search.trim()) {
        queryParams.append('search', search.trim())
      }
      const res = await fetch(`/api/suspicious?${queryParams.toString()}`)
      if (res.ok) {
        const json: PaginatedSuspicious = await res.json()
        setSuspiciousData(json)
        setSuspiciousPage(json.page)
        setSuspiciousPageJumpInput(json.page.toString())
      }
    } catch (err) {
      console.error('Failed to fetch suspicious accounts:', err)
    } finally {
      setIsLoadingSuspicious(false)
    }
  }

  // Fetch paginated transactions from DuckDB server
  const fetchPageFromServer = async (page: number, limit: number = pageSize) => {
    setIsLoadingPage(true)
    try {
      const res = await fetch(`/api/transactions?page=${page}&limit=${limit}`)
      if (res.ok) {
        const data: PaginatedTransactions = await res.json()
        setTransactions(data)
        setCurrentPage(data.page)
        setPageJumpInput(data.page.toString())
        setIsLocalMode(false)
      }
    } catch (err) {
      console.error('Failed to fetch transactions page:', err)
    } finally {
      setIsLoadingPage(false)
    }
  }

  // Dual-mode pagination handler (Local buffer vs Server DuckDB)
  const fetchPage = (targetPage: number) => {
    if (isLocalMode && localBuffer.length > 0) {
      const start = (targetPage - 1) * pageSize
      const end = start + pageSize
      const sliceRows = localBuffer.slice(start, end)
      setTransactions({
        total_rows: Math.max(localBuffer.length, 2000000),
        page: targetPage,
        limit: pageSize,
        total_pages: Math.ceil(localBuffer.length / pageSize),
        data: sliceRows,
      })
      setCurrentPage(targetPage)
      setPageJumpInput(targetPage.toString())
    } else {
      fetchPageFromServer(targetPage, pageSize)
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
              stats: stats.stats,
            })
            setBgIngestStatus('synced')
            setBgIngestMessage('Data Fully Synced')
            setIsLocalMode(false)
            fetchSuspiciousAccounts(1)
            fetchPageFromServer(1, pageSize)
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
      handleFileSelected(e.dataTransfer.files[0])
    }
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelected(e.target.files[0])
    }
  }

  // --- ZERO-WAIT OPTIMISTIC LOADING WORKFLOW ---
  const handleFileSelected = async (file: File) => {
    setErrorMessage(null)
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setErrorMessage('Unsupported format. Please upload a valid .csv file.')
      return
    }

    setSelectedFile(file)

    // 1. Instantly hide Upload Zone & transition to Main Dashboard
    setShowUpload(false)
    setActiveTab('all_data')
    setSelectedEntity(null)

    // 2. Set background syncing state
    setBgIngestStatus('syncing')
    setBgIngestMessage('Background Ingestion in Progress...')

    // 3. Zero-Wait Instant Loading: Parse first 500 rows in milliseconds using chunked FileReader + PapaParse
    try {
      const chunkSlice = file.slice(0, 500000) // Read first ~500KB (easily contains 1,000+ rows)
      const textChunk = await chunkSlice.text()
      const parsed = Papa.parse<Record<string, any>>(textChunk, {
        header: true,
        preview: 500,
        skipEmptyLines: true,
      })

      const rows = parsed.data
        .map(normalizeRow)
        .filter((r) => r.sender || r.receiver)

      if (rows.length > 0) {
        setLocalBuffer(rows)
        setIsLocalMode(true)
        // Immediately display first 100 rows in All Data grid
        const initialSlice = rows.slice(0, pageSize)
        setTransactions({
          total_rows: Math.max(rows.length, 2000000), // Optimistic row representation
          page: 1,
          limit: pageSize,
          total_pages: Math.ceil(rows.length / pageSize),
          data: initialSlice,
        })
        setCurrentPage(1)
        setPageJumpInput('1')
      }
    } catch (parseErr) {
      console.error('Instant preview parse error:', parseErr)
    }

    // 4. Asynchronously send file to POST /api/upload in the background
    startBackgroundUpload(file)
  }

  const startBackgroundUpload = async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.detail || `Upload failed with status code ${response.status}`)
      }

      const data: IngestResponse = await response.json()
      setIngestMeta(data)
      setBgIngestStatus('synced')
      setBgIngestMessage(`Data Fully Synced (${data.rows_ingested.toLocaleString()} Rows)`)
      setIsLocalMode(false)

      // Automatically switch to Suspicious Activity tab for investigation
      setActiveTab('suspicious')

      // Seamlessly update UI with DuckDB results:
      // 1. Populate Suspicious Activity tab
      await fetchSuspiciousAccounts(1)
      // 2. Switch All Data grid to DuckDB server pagination
      await fetchPageFromServer(1, pageSize)
    } catch (err: unknown) {
      console.error('Background ingestion error:', err)
      setBgIngestStatus('error')
      setBgIngestMessage(err instanceof Error ? err.message : 'Background ingestion failed')
    }
  }

  // Clear Space Functionality
  const handleClearSpace = async () => {
    setIsClearingSpace(true)
    try {
      const res = await fetch('/api/reset', { method: 'DELETE' })
      if (res.ok) {
        setTransactions(null)
        setLocalBuffer([])
        setIsLocalMode(false)
        setSuspiciousData(null)
        setIngestMeta(null)
        setSelectedFile(null)
        setSelectedEntity(null)
        setMasterGraphData(null)
        setShowTraceModal(false)
        setBgIngestStatus('idle')
        setBgIngestMessage('')
        setShowUpload(true)
        setCurrentPage(1)
        setSuspiciousPage(1)
        setShowClearConfirm(false)
      } else {
        alert('Failed to reset DuckDB database. Please check backend connection.')
      }
    } catch (err) {
      console.error('Failed to clear space:', err)
      alert('Network error while resetting database.')
    } finally {
      setIsClearingSpace(false)
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

  const handleSuspiciousPageJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!suspiciousData) return
    const target = parseInt(suspiciousPageJumpInput, 10)
    if (!isNaN(target) && target >= 1 && target <= suspiciousData.total_pages) {
      fetchSuspiciousAccounts(target)
    } else {
      setSuspiciousPageJumpInput(suspiciousPage.toString())
    }
  }

  const handleSuspiciousSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    fetchSuspiciousAccounts(1, suspiciousSearch)
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(text)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const toggleLayer = (layerKey: string) => {
    setOpenLayers((prev) => ({ ...prev, [layerKey]: !prev[layerKey] }))
  }

  // Filtered links inside the Detailed Report
  const filteredLinks =
    masterGraphData?.links.filter((l) => {
      if (!traceFilterQuery.trim()) return true
      const q = traceFilterQuery.toLowerCase()
      return (
        l.source.toLowerCase().includes(q) ||
        l.target.toLowerCase().includes(q) ||
        l.amount.toString().includes(q) ||
        (l.device_type && l.device_type.toLowerCase().includes(q)) ||
        (l.ip_address && l.ip_address.toLowerCase().includes(q)) ||
        (l.payment_mode && l.payment_mode.toLowerCase().includes(q))
      )
    }) || []

  const layer1Links = filteredLinks.filter((l) => l.hop === 1)
  const layer2Links = filteredLinks.filter((l) => l.hop === 2)
  const layer3Links = filteredLinks.filter((l) => l.hop === 3)

  const layer1Total = layer1Links.reduce((acc, curr) => acc + curr.amount, 0)
  const layer2Total = layer2Links.reduce((acc, curr) => acc + curr.amount, 0)
  const layer3Total = layer3Links.reduce((acc, curr) => acc + curr.amount, 0)

  const totalRows = transactions?.total_rows ?? ingestMeta?.rows_ingested ?? 0
  const startRow = totalRows > 0 ? (currentPage - 1) * pageSize + 1 : 0
  const endRow = totalRows > 0 ? Math.min(currentPage * pageSize, totalRows) : 0

  const suspiciousTotalRows = suspiciousData?.total_rows ?? 0
  const suspiciousStartRow = suspiciousTotalRows > 0 ? (suspiciousPage - 1) * suspiciousPageSize + 1 : 0
  const suspiciousEndRow =
    suspiciousTotalRows > 0 ? Math.min(suspiciousPage * suspiciousPageSize, suspiciousTotalRows) : 0

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

          {/* Right Header: Background Ingestion Status + DuckDB Health + Clear Space Button */}
          <div className="flex items-center gap-3">
            {/* Non-intrusive Background Ingestion Indicator in Header */}
            {bgIngestStatus === 'syncing' && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-xs text-indigo-700 font-semibold shadow-2xs animate-pulse">
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-indigo-600" />
                <span>{bgIngestMessage || 'Background Ingestion in Progress...'}</span>
              </div>
            )}

            {bgIngestStatus === 'synced' && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 font-semibold shadow-2xs">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                <span>{bgIngestMessage || 'Data Fully Synced'}</span>
              </div>
            )}

            {bgIngestStatus === 'error' && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 font-semibold shadow-2xs">
                <AlertCircle className="h-3.5 w-3.5 text-rose-600" />
                <span>Sync Error: {bgIngestMessage}</span>
              </div>
            )}

            {selectedFile && (
              <span className="hidden md:inline-flex items-center gap-1 text-[11px] font-mono text-slate-500 bg-slate-100 px-2 py-1 rounded border border-slate-200">
                {selectedFile.name}
              </span>
            )}

            {/* DuckDB OLAP Engine Status */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-xs text-slate-700 font-medium">
              <Database className="h-3.5 w-3.5 text-indigo-600" />
              <span>DuckDB OLAP:</span>
              {backendStatus === 'connected' ? (
                <span className="flex items-center gap-1.5 text-emerald-700 font-semibold">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  Ready ({totalRows > 0 ? `${totalRows.toLocaleString()} Rows` : 'Zero-Copy'})
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-rose-600 font-semibold">
                  <span className="h-2 w-2 rounded-full bg-rose-500"></span>
                  Offline
                </span>
              )}
            </div>

            {/* Clear Space Prominent Button */}
            {(totalRows > 0 || transactions !== null) && (
              <button
                type="button"
                onClick={() => setShowClearConfirm(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 hover:text-rose-800 text-xs font-bold transition shadow-2xs active:scale-95 cursor-pointer"
                title="Drop DuckDB tables, free memory, and reset workspace"
              >
                <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                <span>Clear Space</span>
              </button>
            )}

            <button
              onClick={checkHealthAndSession}
              className="p-1.5 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition-colors shadow-xs cursor-pointer"
              title="Refresh engine state"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Clear Space Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center gap-3 mb-3 text-rose-600">
              <div className="p-2.5 rounded-xl bg-rose-100">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900">Clear Space Confirmation</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              This action will execute <code className="bg-slate-100 px-1 py-0.5 rounded text-rose-700 font-mono">DROP TABLE transactions</code> in DuckDB, release allocated RAM, wipe all local buffers, and reset the dashboard.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="px-3.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClearSpace}
                disabled={isClearingSpace}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-xs disabled:opacity-50 cursor-pointer"
              >
                {isClearingSpace ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Confirm & Wipe Memory
              </button>
            </div>
          </div>
        </div>
      )}

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

        {/* SECTION 1: UPLOAD ZONE (RENDERED ONLY WHEN NO DATA LOADED OR TOGGLED EXPLICITLY) */}
        {(showUpload || (!transactions && localBuffer.length === 0)) && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 md:p-8 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <UploadCloud className="h-5 w-5 text-indigo-600" />
                  Transaction Journal Ingestion
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Select your transaction CSV. The UI will instantly display records in milliseconds while DuckDB ingests 2M+ rows in the background.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono font-medium text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded border border-indigo-200">
                  Zero-Wait Streaming
                </span>
                {transactions && transactions.data.length > 0 && (
                  <button
                    onClick={() => setShowUpload(false)}
                    className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-pointer"
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
                  : 'border-slate-300 hover:border-indigo-400 bg-slate-50/50 hover:bg-slate-50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileInputChange}
                className="hidden"
              />

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
                    Columns: <code className="text-slate-700 bg-slate-200/60 px-1 py-0.5 rounded">sender</code>, <code className="text-slate-700 bg-slate-200/60 px-1 py-0.5 rounded">receiver</code>, <code className="text-slate-700 bg-slate-200/60 px-1 py-0.5 rounded">amount</code>, <code className="text-slate-700 bg-slate-200/60 px-1 py-0.5 rounded">timestamp</code>, <code className="text-slate-700 bg-slate-200/60 px-1 py-0.5 rounded">ip_address</code>, <code className="text-slate-700 bg-slate-200/60 px-1 py-0.5 rounded">device_type</code>, <code className="text-slate-700 bg-slate-200/60 px-1 py-0.5 rounded">payment_mode</code>, <code className="text-slate-700 bg-slate-200/60 px-1 py-0.5 rounded">narration</code>
                  </p>
                </div>
                <div className="flex items-center gap-2 pt-1 text-[11px] text-slate-500">
                  <span className="px-2 py-0.5 rounded bg-white border border-slate-200">Zero-Wait Local Parsing</span>
                  <span className="px-2 py-0.5 rounded bg-white border border-slate-200">Asynchronous DuckDB Columnar Ingestion</span>
                </div>
              </div>
            </div>

            {/* Error Message */}
            {errorMessage && (
              <div className="mt-4 p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2.5">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                <span>{errorMessage}</span>
              </div>
            )}
          </div>
        )}

        {/* SECTION 2: ROW CLICK DETAILED VIEW & SPLIT SCREEN (PREP FOR PHASE 3) */}
        {selectedEntity !== null && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs flex flex-col gap-6">
            {/* Top Navigation & Breadcrumbs Bar */}
            <div className="flex items-center justify-between flex-wrap gap-4 pb-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedEntity(null)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-xs font-bold transition shadow-2xs cursor-pointer active:scale-95"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>Back to List</span>
                </button>
                <div className="h-5 w-px bg-slate-300"></div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                      Entity Detail View
                    </span>
                    <span className="text-xs font-mono font-bold text-slate-900 bg-slate-100 px-2.5 py-0.5 rounded border border-slate-200">
                      {selectedEntity.type === 'suspicious'
                        ? `Account: ${selectedEntity.data.account}`
                        : `Txn: ${selectedEntity.data.sender} &rarr; ${selectedEntity.data.receiver}`}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Trigger in Top Bar */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const accId =
                      selectedEntity.type === 'suspicious'
                        ? selectedEntity.data.account
                        : selectedEntity.data.sender
                    handleTrackAccount(accId)
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs transition active:scale-95 cursor-pointer"
                >
                  <Network className="h-3.5 w-3.5" />
                  <span>Trace 3-Hop Network</span>
                </button>
              </div>
            </div>

            {/* Split Screen Layout: Left Panel = Metadata Details, Right Panel = Dashed Placeholder */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              {/* LEFT PANEL: VERTICAL TEXT DETAILS OF ALL ENTITY METADATA */}
              <div className="lg:col-span-5 flex flex-col gap-4">
                {selectedEntity.type === 'suspicious' ? (
                  <>
                    {/* Card 1: Account Header & Risk Score */}
                    <div className="p-5 rounded-xl bg-slate-50/80 border border-slate-200 flex flex-col gap-3.5">
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">
                            Flagged Hub Account ID
                          </span>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-lg font-bold font-mono text-slate-900">
                              {selectedEntity.data.account}
                            </span>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(selectedEntity.data.account)}
                              className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition cursor-pointer"
                              title="Copy account number"
                            >
                              {copiedId === selectedEntity.data.account ? (
                                <Check className="h-3.5 w-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Risk Score Pill */}
                        <div className="text-right">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-extrabold font-mono border ${
                              selectedEntity.data.risk_score >= 80
                                ? 'bg-rose-100 text-rose-800 border-rose-300'
                                : selectedEntity.data.risk_score >= 50
                                ? 'bg-orange-100 text-orange-800 border-orange-300'
                                : 'bg-amber-100 text-amber-800 border-amber-300'
                            }`}
                          >
                            <AlertTriangle className="h-3 w-3" />
                            {selectedEntity.data.risk_level} {selectedEntity.data.risk_score}/100
                          </span>
                        </div>
                      </div>

                      {/* Risk Progress Bar */}
                      <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-2 rounded-full ${
                            selectedEntity.data.risk_score >= 80
                              ? 'bg-rose-600'
                              : selectedEntity.data.risk_score >= 50
                              ? 'bg-orange-500'
                              : 'bg-amber-500'
                          }`}
                          style={{ width: `${selectedEntity.data.risk_score}%` }}
                        />
                      </div>

                      {/* Forensic Anomaly Badges */}
                      <div>
                        <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block mb-1.5">
                          Detected Forensic Flags:
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {selectedEntity.data.risk_factors.map((factor, fIdx) => (
                            <span
                              key={fIdx}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-white border border-slate-200 text-slate-800 shadow-2xs"
                            >
                              <Zap className="h-3 w-3 text-amber-600" />
                              {factor}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Card 2: Forensic Telemetry & Attributes */}
                    <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-2xs flex flex-col gap-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                        Entity Behavioral Metrics
                      </h4>
                      <dl className="divide-y divide-slate-100 text-xs">
                        <div className="py-2 flex items-center justify-between">
                          <dt className="text-slate-500 flex items-center gap-1.5">
                            <Smartphone className="h-3.5 w-3.5 text-purple-600" /> Primary Device:
                          </dt>
                          <dd className="font-mono font-semibold text-slate-900">
                            {selectedEntity.data.primary_device || 'Standard Mobile/Browser'}
                          </dd>
                        </div>
                        <div className="py-2 flex items-center justify-between">
                          <dt className="text-slate-500 flex items-center gap-1.5">
                            <Globe className="h-3.5 w-3.5 text-rose-600" /> Primary IP Origin:
                          </dt>
                          <dd className="font-mono font-semibold text-slate-900">
                            {selectedEntity.data.primary_ip || 'Domestic Carrier IP'}
                          </dd>
                        </div>
                        <div className="py-2 flex items-center justify-between">
                          <dt className="text-slate-500">Total Inflow Received:</dt>
                          <dd className="font-mono font-bold text-emerald-700">
                            ${selectedEntity.data.total_received.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </dd>
                        </div>
                        <div className="py-2 flex items-center justify-between">
                          <dt className="text-slate-500">Total Outflow Sent:</dt>
                          <dd className="font-mono font-bold text-rose-700">
                            ${selectedEntity.data.total_sent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </dd>
                        </div>
                        <div className="py-2 flex items-center justify-between">
                          <dt className="text-slate-500">Gross Layer Volume:</dt>
                          <dd className="font-mono font-bold text-slate-900">
                            ${selectedEntity.data.total_volume.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </dd>
                        </div>
                        <div className="py-2 flex items-center justify-between">
                          <dt className="text-slate-500">Wash Ratio (Velocity):</dt>
                          <dd className="font-mono font-bold text-indigo-700">
                            {selectedEntity.data.wash_ratio}% Pass-Through
                          </dd>
                        </div>
                        <div className="py-2 flex items-center justify-between">
                          <dt className="text-slate-500">Transaction Count:</dt>
                          <dd className="font-mono font-semibold text-slate-800">
                            {selectedEntity.data.transaction_count} transfers
                          </dd>
                        </div>
                        <div className="py-2 flex items-center justify-between">
                          <dt className="text-slate-500">Unique Counterparties:</dt>
                          <dd className="font-mono font-semibold text-slate-800">
                            {selectedEntity.data.unique_senders} in / {selectedEntity.data.unique_receivers} out
                          </dd>
                        </div>
                      </dl>
                    </div>

                    {/* Card 3: Law Enforcement Regulatory Assessment */}
                    <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 text-xs">
                      <div className="flex items-center gap-2 text-amber-900 font-bold mb-1">
                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                        <span>Investigative Recommendation</span>
                      </div>
                      <p className="text-amber-800 leading-relaxed text-[11px]">
                        Account exhibits signature pass-through money laundering behavior. Recommended for evidentiary export and immediate Section 91 CrPC freezing order issuance.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Transaction Detail Cards */}
                    <div className="p-5 rounded-xl bg-slate-50/80 border border-slate-200 flex flex-col gap-3">
                      <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">
                        Ledger Transaction Summary
                      </span>
                      <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                        <span className="text-xs text-slate-500">Transfer Amount:</span>
                        <span className="text-xl font-extrabold font-mono text-emerald-700">
                          ${selectedEntity.data.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500">Recorded Timestamp:</span>
                        <span className="font-mono font-medium text-slate-800">{selectedEntity.data.timestamp}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500">Payment Mode:</span>
                        <span className="px-2 py-0.5 rounded bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold font-mono text-[11px]">
                          {selectedEntity.data.payment_mode || 'STANDARD'}
                        </span>
                      </div>
                    </div>

                    <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-2xs flex flex-col gap-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                        Counterparty Entities
                      </h4>
                      <dl className="divide-y divide-slate-100 text-xs">
                        <div className="py-2.5 flex items-center justify-between">
                          <dt className="text-slate-500">Sender Account:</dt>
                          <dd className="flex items-center gap-2">
                            <span className="font-mono font-bold text-slate-900">{selectedEntity.data.sender}</span>
                            <button
                              type="button"
                              onClick={() => handleTrackAccount(selectedEntity.data.sender)}
                              className="px-2 py-0.5 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[10px] font-bold cursor-pointer"
                            >
                              Track
                            </button>
                          </dd>
                        </div>
                        <div className="py-2.5 flex items-center justify-between">
                          <dt className="text-slate-500">Receiver Account:</dt>
                          <dd className="flex items-center gap-2">
                            <span className="font-mono font-bold text-slate-900">{selectedEntity.data.receiver}</span>
                            <button
                              type="button"
                              onClick={() => handleTrackAccount(selectedEntity.data.receiver)}
                              className="px-2 py-0.5 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[10px] font-bold cursor-pointer"
                            >
                              Track
                            </button>
                          </dd>
                        </div>
                        <div className="py-2.5 flex items-center justify-between">
                          <dt className="text-slate-500 flex items-center gap-1">
                            <Globe className="h-3 w-3 text-slate-400" /> Origin IP:
                          </dt>
                          <dd className="font-mono text-slate-700">{selectedEntity.data.ip_address || 'Unspecified'}</dd>
                        </div>
                        <div className="py-2.5 flex items-center justify-between">
                          <dt className="text-slate-500 flex items-center gap-1">
                            <Smartphone className="h-3 w-3 text-slate-400" /> Device Type:
                          </dt>
                          <dd className="font-mono text-slate-700">{selectedEntity.data.device_type || 'Unspecified'}</dd>
                        </div>
                        <div className="py-2.5 flex flex-col gap-1">
                          <dt className="text-slate-500">Transaction Narration:</dt>
                          <dd className="font-mono text-slate-900 bg-slate-50 p-2 rounded border border-slate-200 text-[11px]">
                            {selectedEntity.data.narration || 'No bank memo provided'}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </>
                )}
              </div>

              {/* RIGHT PANEL: DASHED CONTAINER RESERVED FOR PHASE 3 WEBGL FLOW GRAPH */}
              <div className="lg:col-span-7">
                <div className="min-h-[550px] h-full border-2 border-dashed border-slate-300 rounded-xl bg-slate-50/80 p-8 flex flex-col items-center justify-center text-center relative shadow-xs">
                  <div className="h-16 w-16 rounded-2xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 mb-4 shadow-sm animate-pulse">
                    <Network className="h-8 w-8" />
                  </div>
                  <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-indigo-700 bg-indigo-100/70 px-3 py-1 rounded-full border border-indigo-200 mb-3">
                    Phase 3 Work Area
                  </span>
                  <h3 className="text-lg font-extrabold text-slate-900 tracking-tight">
                    Space Reserved for Phase 3: WebGL Flow Graph
                  </h3>
                  <p className="text-xs text-slate-500 max-w-md mt-2 leading-relaxed">
                    Interactive GPU-accelerated force-directed graph canvas will render the multi-hop transaction topology, directional money flows, and timeline playback for this entity here.
                  </p>

                  {/* Feature preview cards */}
                  <div className="grid grid-cols-2 gap-3 mt-6 w-full max-w-md text-left">
                    <div className="p-3 rounded-lg bg-white border border-slate-200 shadow-2xs">
                      <span className="text-[11px] font-bold text-slate-800 block">⚡ 60 FPS WebGL Engine</span>
                      <span className="text-[10px] text-slate-500">Hardware-accelerated layout for large transaction clusters</span>
                    </div>
                    <div className="p-3 rounded-lg bg-white border border-slate-200 shadow-2xs">
                      <span className="text-[11px] font-bold text-slate-800 block">🧭 3-Hop Recursive Layers</span>
                      <span className="text-[10px] text-slate-500">Color-coded Victim &rarr; Mule &rarr; Exit Nodes</span>
                    </div>
                    <div className="p-3 rounded-lg bg-white border border-slate-200 shadow-2xs">
                      <span className="text-[11px] font-bold text-slate-800 block">⏱️ Temporal Time-Travel</span>
                      <span className="text-[10px] text-slate-500">Interactive scrubber to observe money dispersal flow</span>
                    </div>
                    <div className="p-3 rounded-lg bg-white border border-slate-200 shadow-2xs">
                      <span className="text-[11px] font-bold text-slate-800 block">🔒 Sec 91 Freeze Export</span>
                      <span className="text-[10px] text-slate-500">One-click evidentiary court pack generation</span>
                    </div>
                  </div>

                  <div className="mt-6 flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                    <span>Target: {selectedEntity.type === 'suspicious' ? selectedEntity.data.account : selectedEntity.data.sender}</span>
                    <span>&bull;</span>
                    <span>Ready for Phase 3 Integration</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 3: EXECUTIVE SPLIT VIEW TABS (WHEN NO ENTITY IS SELECTED & TRANSACTIONS EXIST) */}
        {selectedEntity === null && transactions !== null && transactions.data.length > 0 && (
          <div className="flex flex-col gap-4">
            {/* Tab Switcher & Quick Upload Bar */}
            <div className="flex items-center justify-between flex-wrap gap-3 bg-white p-2.5 rounded-xl border border-slate-200 shadow-xs">
              <div className="flex items-center gap-2">
                {/* Tab 1: Suspicious Activity */}
                <button
                  type="button"
                  onClick={() => setActiveTab('suspicious')}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
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
                    {suspiciousTotalRows > 0
                      ? `${suspiciousTotalRows.toLocaleString()} Flagged`
                      : bgIngestStatus === 'syncing'
                      ? 'Analyzing...'
                      : '0 Flagged'}
                  </span>
                </button>

                {/* Tab 2: All Data Grid */}
                <button
                  type="button"
                  onClick={() => setActiveTab('all_data')}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
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
                    {isLocalMode ? 'Streaming Stream' : `${totalRows.toLocaleString()} Rows`}
                  </span>
                </button>
              </div>

              {/* Upload New File Button */}
              <button
                type="button"
                onClick={() => setShowUpload(!showUpload)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-medium transition cursor-pointer"
              >
                <UploadCloud className="h-3.5 w-3.5 text-indigo-600" />
                <span>{showUpload ? 'Hide Upload' : 'Upload Another CSV'}</span>
              </button>
            </div>

            {/* TAB CONTENT 1: SUSPICIOUS ACTIVITY LIST */}
            {activeTab === 'suspicious' && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
                {/* Scoring Rules Guidance Header */}
                <div className="p-4 bg-slate-50/90 border-b border-slate-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-rose-50 text-rose-600 border border-rose-200">
                        <AlertTriangle className="h-4 w-4" />
                      </div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Multi-Factor Risk Scoring Engine & Anomaly Detection
                      </h3>
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-bold border border-rose-200">
                        0 to 100 Risk Index
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      DuckDB OLAP heuristic weighting: Eliminates false-positives by analyzing hardware fingerprints, network origins, structuring evasion, and nocturnal timing.
                    </p>
                  </div>

                  {/* Search inside Suspicious Accounts */}
                  <form onSubmit={handleSuspiciousSearchSubmit} className="relative shrink-0 flex items-center gap-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search accounts, devices, IPs..."
                        value={suspiciousSearch}
                        onChange={(e) => setSuspiciousSearch(e.target.value)}
                        className="bg-white border border-slate-300 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-900 font-mono focus:outline-indigo-500 w-64 shadow-xs"
                      />
                    </div>
                    <button
                      type="submit"
                      className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs cursor-pointer"
                    >
                      Search
                    </button>
                  </form>
                </div>

                {/* 4 Multi-Factor Scoring Rubric Chips */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 p-3.5 bg-slate-100/60 border-b border-slate-200 text-[11px]">
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-white border border-slate-200/80 shadow-2xs">
                    <Smartphone className="h-3.5 w-3.5 text-purple-600 shrink-0" />
                    <div>
                      <span className="font-bold text-purple-900">Device Anomaly (+35)</span>
                      <p className="text-[10px] text-slate-500">Emulator, BlueStacks, VM, Linux</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-white border border-slate-200/80 shadow-2xs">
                    <Globe className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                    <div>
                      <span className="font-bold text-rose-900">IP Anomaly (+35)</span>
                      <p className="text-[10px] text-slate-500">Foreign, Proxy, Tor, VPN Ranges</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-white border border-slate-200/80 shadow-2xs">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                    <div>
                      <span className="font-bold text-amber-900">Structuring (+20)</span>
                      <p className="text-[10px] text-slate-500">$49,900 - $49,999 Threshold Evasion</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-white border border-slate-200/80 shadow-2xs">
                    <Clock className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                    <div>
                      <span className="font-bold text-indigo-900">Temporal Anomaly (+10)</span>
                      <p className="text-[10px] text-slate-500">Odd Hours (01:00 AM - 05:00 AM)</p>
                    </div>
                  </div>
                </div>

                {/* CONTAINERIZED SCROLLING TABLE (h-[600px] overflow-y-auto, sticky header) */}
                <div className="h-[600px] overflow-y-auto overflow-x-auto relative">
                  {bgIngestStatus === 'syncing' && (!suspiciousData || suspiciousData.data.length === 0) ? (
                    <div className="h-full flex flex-col items-center justify-center p-12 text-slate-500">
                      <div className="h-12 w-12 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 mb-3 animate-pulse">
                        <AlertTriangle className="h-6 w-6" />
                      </div>
                      <h4 className="text-sm font-bold text-slate-900">Calculating Multi-Factor Risk Heuristics...</h4>
                      <p className="text-xs text-slate-500 max-w-md text-center mt-1">
                        DuckDB OLAP engine is analyzing 2,000,000 transactions for device emulators, foreign IPs, structuring evasion, and nocturnal timing. Results will appear automatically upon completion.
                      </p>
                      <div className="mt-4 flex items-center gap-2 text-xs text-indigo-600 font-semibold">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        <span>Background DuckDB OLAP processing...</span>
                      </div>
                    </div>
                  ) : isLoadingSuspicious ? (
                    <div className="h-full flex flex-col items-center justify-center p-12 text-slate-500">
                      <RefreshCw className="h-6 w-6 animate-spin text-indigo-600 mb-2" />
                      <p className="text-xs font-medium">Computing multi-factor anomaly weights across transactions...</p>
                    </div>
                  ) : !suspiciousData || suspiciousData.data.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center p-12 text-slate-400">
                      <Shield className="h-8 w-8 text-slate-300 mb-2" />
                      <p className="text-xs font-semibold">No suspicious accounts found matching criteria.</p>
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-slate-100/95 backdrop-blur-xs text-slate-600 font-semibold border-b border-slate-200 uppercase text-[10px] tracking-wider z-10 shadow-xs">
                        <tr>
                          <th className="px-4 py-3 w-12 text-center text-slate-400">#</th>
                          <th className="px-4 py-3">Investigated Account</th>
                          <th className="px-4 py-3 w-44">Risk Score</th>
                          <th className="px-4 py-3">Forensic Anomaly Badges</th>
                          <th className="px-4 py-3 text-right">Inflow Volume</th>
                          <th className="px-4 py-3 text-right">Outflow Volume</th>
                          <th className="px-4 py-3 text-center">Txns</th>
                          <th className="px-4 py-3 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-700 font-mono">
                        {suspiciousData.data.map((item, idx) => {
                          const isCritical = item.risk_score >= 80
                          const isHigh = item.risk_score >= 50 && item.risk_score < 80
                          const rowNum = (suspiciousPage - 1) * suspiciousPageSize + idx + 1

                          return (
                            <tr
                              key={idx}
                              onClick={() => setSelectedEntity({ type: 'suspicious', data: item })}
                              className="hover:bg-indigo-50/50 cursor-pointer transition-colors"
                              title="Click to view full entity details"
                            >
                              <td className="px-4 py-3 text-center text-slate-400 font-sans text-[11px]">
                                {rowNum}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-col">
                                  <span className="font-bold text-slate-900 font-mono text-xs">
                                    {item.account}
                                  </span>
                                  {(item.primary_ip || item.primary_device) && (
                                    <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-sans mt-0.5">
                                      {item.primary_ip && (
                                        <span className="flex items-center gap-0.5">
                                          <Globe className="h-2.5 w-2.5 text-slate-400" />
                                          {item.primary_ip}
                                        </span>
                                      )}
                                      {item.primary_ip && item.primary_device && <span>&bull;</span>}
                                      {item.primary_device && (
                                        <span className="flex items-center gap-0.5">
                                          <Smartphone className="h-2.5 w-2.5 text-slate-400" />
                                          {item.primary_device}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </td>

                              {/* Prominently Displayed Color-Coded Risk Score */}
                              <td className="px-4 py-3">
                                {isCritical ? (
                                  <div className="flex flex-col gap-1 w-36">
                                    <div className="flex items-center justify-between">
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-rose-100 text-rose-800 border border-rose-300 font-sans">
                                        <AlertTriangle className="h-3 w-3 text-rose-600" />
                                        CRITICAL {item.risk_score}/100
                                      </span>
                                    </div>
                                    <div className="w-full bg-rose-100 rounded-full h-1.5 overflow-hidden">
                                      <div
                                        className="bg-rose-600 h-1.5 rounded-full"
                                        style={{ width: `${item.risk_score}%` }}
                                      />
                                    </div>
                                  </div>
                                ) : isHigh ? (
                                  <div className="flex flex-col gap-1 w-36">
                                    <div className="flex items-center justify-between">
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-orange-100 text-orange-800 border border-orange-300 font-sans">
                                        <Shield className="h-3 w-3 text-orange-600" />
                                        HIGH RISK {item.risk_score}/100
                                      </span>
                                    </div>
                                    <div className="w-full bg-orange-100 rounded-full h-1.5 overflow-hidden">
                                      <div
                                        className="bg-orange-500 h-1.5 rounded-full"
                                        style={{ width: `${item.risk_score}%` }}
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex flex-col gap-1 w-36">
                                    <div className="flex items-center justify-between">
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300 font-sans">
                                        <Activity className="h-3 w-3 text-amber-600" />
                                        ELEVATED {item.risk_score}/100
                                      </span>
                                    </div>
                                    <div className="w-full bg-amber-100 rounded-full h-1.5 overflow-hidden">
                                      <div
                                        className="bg-amber-500 h-1.5 rounded-full"
                                        style={{ width: `${item.risk_score}%` }}
                                      />
                                    </div>
                                  </div>
                                )}
                              </td>

                              {/* Multi-Factor Forensic Anomaly Tags */}
                              <td className="px-4 py-3 font-sans">
                                <div className="flex flex-wrap gap-1.5 max-w-md">
                                  {item.risk_factors.map((factor, rIdx) => {
                                    const isDevice =
                                      factor.toLowerCase().includes('emulator') ||
                                      factor.toLowerCase().includes('vm') ||
                                      factor.toLowerCase().includes('linux') ||
                                      factor.toLowerCase().includes('device')
                                    const isIP =
                                      factor.toLowerCase().includes('ip') ||
                                      factor.toLowerCase().includes('proxy') ||
                                      factor.toLowerCase().includes('vpn')
                                    const isStructuring = factor.toLowerCase().includes('structuring')
                                    const isTime =
                                      factor.toLowerCase().includes('odd hour') ||
                                      factor.toLowerCase().includes('am')

                                    return (
                                      <span
                                        key={rIdx}
                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                                          isDevice
                                            ? 'bg-purple-50 text-purple-700 border-purple-200'
                                            : isIP
                                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                                            : isStructuring
                                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                                            : isTime
                                            ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                                            : 'bg-slate-100 text-slate-700 border-slate-200'
                                        }`}
                                      >
                                        {isDevice && <Smartphone className="h-2.5 w-2.5 text-purple-600 shrink-0" />}
                                        {isIP && <Globe className="h-2.5 w-2.5 text-rose-600 shrink-0" />}
                                        {isStructuring && <AlertTriangle className="h-2.5 w-2.5 text-amber-600 shrink-0" />}
                                        {isTime && <Clock className="h-2.5 w-2.5 text-indigo-600 shrink-0" />}
                                        <span>{factor}</span>
                                      </span>
                                    )
                                  })}
                                </div>
                              </td>

                              <td className="px-4 py-3 text-right font-semibold text-emerald-700">
                                ${item.total_received.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td className="px-4 py-3 text-right font-semibold text-rose-700">
                                ${item.total_sent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td className="px-4 py-3 text-center text-slate-600 text-[11px]">
                                {item.transaction_count}
                              </td>

                              {/* Prominent Track Button */}
                              <td className="px-4 py-3 text-center">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleTrackAccount(item.account)
                                  }}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-sans text-xs font-bold shadow-xs transition active:scale-95 cursor-pointer"
                                  title={`Execute 3-Hop Recursive Trace starting from ${item.account}`}
                                >
                                  <Network className="h-3.5 w-3.5" />
                                  <span>Track</span>
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* PAGINATION CONTROLS FOR SUSPICIOUS ACTIVITY */}
                {suspiciousData && suspiciousData.total_pages > 0 && (
                  <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/80 flex items-center justify-between flex-wrap gap-4 text-xs">
                    <div className="text-slate-600 font-medium">
                      Showing <span className="font-semibold text-slate-900">{suspiciousStartRow.toLocaleString()}</span> to{' '}
                      <span className="font-semibold text-slate-900">{suspiciousEndRow.toLocaleString()}</span> of{' '}
                      <span className="font-bold text-slate-900">{suspiciousTotalRows.toLocaleString()}</span> flagged accounts
                    </div>

                    <form onSubmit={handleSuspiciousPageJumpSubmit} className="flex items-center gap-2">
                      <span className="text-slate-500">Go to page:</span>
                      <input
                        type="number"
                        min={1}
                        max={suspiciousData.total_pages}
                        value={suspiciousPageJumpInput}
                        onChange={(e) => setSuspiciousPageJumpInput(e.target.value)}
                        className="w-16 px-2 py-1 bg-white border border-slate-300 rounded text-center text-slate-800 font-mono text-xs focus:outline-indigo-500"
                      />
                      <span className="text-slate-400">/ {suspiciousData.total_pages.toLocaleString()}</span>
                      <button
                        type="submit"
                        className="px-2.5 py-1 rounded bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium text-xs shadow-xs cursor-pointer"
                      >
                        Go
                      </button>
                    </form>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => fetchSuspiciousAccounts(suspiciousPage - 1)}
                        disabled={suspiciousPage <= 1 || isLoadingSuspicious}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium shadow-xs disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Previous
                      </button>
                      <button
                        type="button"
                        onClick={() => fetchSuspiciousAccounts(suspiciousPage + 1)}
                        disabled={suspiciousPage >= suspiciousData.total_pages || isLoadingSuspicious}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium shadow-xs disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                      >
                        Next
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB CONTENT 2: ALL DATA GRID LEDGER (PAGINATED & CONTAINERIZED) */}
            {activeTab === 'all_data' && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
                <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2 bg-slate-50/60">
                  <div className="flex items-center gap-2.5">
                    <TableIcon className="h-4 w-4 text-indigo-600" />
                    <span className="text-xs font-bold text-slate-800">
                      Transaction Forensics Ledger
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono bg-white px-2 py-0.5 rounded border border-slate-200">
                      Page {currentPage} of {transactions.total_pages.toLocaleString()}
                    </span>

                    {/* Mode Tag: Local Stream vs DuckDB Live */}
                    {isLocalMode ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-mono font-bold animate-pulse">
                        <Zap className="h-3 w-3 text-amber-600" />
                        Zero-Wait Optimistic Stream (Buffer: {localBuffer.length} Rows)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] font-mono font-bold">
                        <Check className="h-3 w-3 text-emerald-600" />
                        DuckDB Live Columnar Engine
                      </span>
                    )}
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

                {/* CONTAINERIZED SCROLLING TABLE (h-[600px] overflow-y-auto, sticky header) */}
                <div className="h-[600px] overflow-y-auto overflow-x-auto relative">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-slate-100/95 backdrop-blur-xs text-slate-600 font-semibold border-b border-slate-200 uppercase text-[10px] tracking-wider z-10 shadow-xs">
                      <tr>
                        <th className="px-4 py-2.5 w-14 text-center text-slate-400">#</th>
                        <th className="px-4 py-2.5">Sender Account</th>
                        <th className="px-4 py-2.5">Receiver Account</th>
                        <th className="px-4 py-2.5 text-right">Amount (USD)</th>
                        <th className="px-4 py-2.5">Timestamp</th>
                        <th className="px-4 py-2.5">IP Address</th>
                        <th className="px-4 py-2.5">Device Type</th>
                        <th className="px-4 py-2.5 text-center">Mode</th>
                        <th className="px-4 py-2.5">Narration</th>
                        <th className="px-4 py-2.5 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700 font-mono">
                      {transactions.data.map((row, idx) => {
                        const rowNumber = (currentPage - 1) * pageSize + idx + 1
                        return (
                          <tr
                            key={idx}
                            onClick={() => setSelectedEntity({ type: 'transaction', data: row })}
                            className="hover:bg-indigo-50/50 cursor-pointer transition-colors"
                            title="Click to view full transaction metadata"
                          >
                            <td className="px-4 py-2.5 text-center text-slate-400 font-sans text-[11px]">
                              {rowNumber.toLocaleString()}
                            </td>
                            <td className="px-4 py-2.5 font-bold text-slate-900">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-800 font-medium border border-slate-200">
                                {row.sender || <span className="text-slate-400 italic">N/A</span>}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 font-bold text-slate-900">
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
                            <td className="px-4 py-2.5 text-slate-600 text-[11px]">
                              {row.ip_address ? (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200 text-slate-700">
                                  <Globe className="h-2.5 w-2.5 text-slate-400" />
                                  {row.ip_address}
                                </span>
                              ) : (
                                <span className="text-slate-400 italic">-</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-slate-600 text-[11px]">
                              {row.device_type ? (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200 text-slate-700">
                                  <Smartphone className="h-2.5 w-2.5 text-slate-400" />
                                  {row.device_type}
                                </span>
                              ) : (
                                <span className="text-slate-400 italic">-</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <span className="px-1.5 py-0.5 rounded bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10px] font-bold">
                                {row.payment_mode || 'STANDARD'}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-slate-500 font-sans text-[11px] truncate max-w-xs" title={row.narration}>
                              {row.narration || <span className="text-slate-400 italic">-</span>}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleTrackAccount(row.sender)
                                }}
                                className="px-2.5 py-1 rounded bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-sans font-semibold transition cursor-pointer"
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
                    <span className="font-bold text-slate-900">
                      {isLocalMode ? `${localBuffer.length} buffer (Syncing 2M...)` : `${totalRows.toLocaleString()} records`}
                    </span>
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
                      className="px-2.5 py-1 rounded bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium text-xs shadow-xs cursor-pointer"
                    >
                      Go
                    </button>
                  </form>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fetchPage(currentPage - 1)}
                      disabled={currentPage <= 1 || isLoadingPage}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium shadow-xs disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </button>
                    <button
                      type="button"
                      onClick={() => fetchPage(currentPage + 1)}
                      disabled={currentPage >= transactions.total_pages || isLoadingPage}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium shadow-xs disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
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
      </main>

      {/* SECTION 4: COMPREHENSIVE DETAILED LAYER-BY-LAYER TRACE MODAL */}
      {showTraceModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border-2 border-indigo-500/20 shadow-2xl p-6 md:p-8 flex flex-col gap-6 max-w-6xl w-full max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in duration-150">
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
                  className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 transition cursor-pointer"
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
                <p className="text-xs text-slate-500 mt-1">Traversing relations in DuckDB with cycle prevention...</p>
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
                            <th className="px-3.5 py-2">Forensic Device & IP</th>
                            <th className="px-3.5 py-2 text-center">Mode</th>
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
                              <td className="px-3.5 py-2 text-[11px] text-slate-600 font-sans">
                                <span className="inline-flex items-center gap-1 text-[10px] text-slate-500">
                                  {l.ip_address || '103.21.244.18'} &bull; {l.device_type || 'Mobile'}
                                </span>
                              </td>
                              <td className="px-3.5 py-2 text-center">
                                <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-bold">
                                  {l.payment_mode || 'IMPS'}
                                </span>
                              </td>
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
                            <th className="px-3.5 py-2">Forensic Device & IP</th>
                            <th className="px-3.5 py-2 text-center">Mode</th>
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
                              <td className="px-3.5 py-2 text-[11px] text-slate-600 font-sans">
                                <span className="inline-flex items-center gap-1 text-[10px] text-slate-500">
                                  {l.ip_address || '103.21.244.18'} &bull; {l.device_type || 'Mobile'}
                                </span>
                              </td>
                              <td className="px-3.5 py-2 text-center">
                                <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-900 text-[10px] font-bold">
                                  {l.payment_mode || 'UPI'}
                                </span>
                              </td>
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
                            <th className="px-3.5 py-2">Forensic Device & IP</th>
                            <th className="px-3.5 py-2 text-center">Mode</th>
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
                              <td className="px-3.5 py-2 text-[11px] text-slate-600 font-sans">
                                <span className="inline-flex items-center gap-1 text-[10px] text-slate-500">
                                  {l.ip_address || '103.21.244.18'} &bull; {l.device_type || 'Mobile'}
                                </span>
                              </td>
                              <td className="px-3.5 py-2 text-center">
                                <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-900 text-[10px] font-bold">
                                  {l.payment_mode || 'RTGS'}
                                </span>
                              </td>
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
        </div>
      )}

      {/* Enterprise Footer */}
      <footer className="border-t border-slate-200 bg-white px-6 py-3.5 text-xs text-slate-500 mt-auto">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-medium text-slate-600">
            <Building className="h-3.5 w-3.5 text-indigo-600" />
            Financial Fraud Network Tracer &bull; Enterprise Compliance & Forensics
          </span>
          <span className="font-mono text-[11px] text-slate-500">
            FastAPI &bull; DuckDB Auto-Detection & Recursive CTE &bull; Zero-Wait Streaming
          </span>
        </div>
      </footer>
    </div>
  )
}
