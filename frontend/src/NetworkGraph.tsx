import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  MarkerType,
  BaseEdge,
  getBezierPath,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import type { Node, Edge, NodeProps, EdgeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import ELK from 'elkjs/lib/elk.bundled.js'
import { downloadFreezeReportPDF } from './reportPdf'

const elk = new ELK()

import {
  Play,
  Pause,
  RotateCcw,
  Clock,
  Building,
  Copy,
  Check,
  Gauge,
  Layers,
  Maximize,
  Minimize2,
  Monitor,
  X,
  Smartphone,
  Globe,
  FileText,
  Focus,
  GripHorizontal,
  Plus,
  Minus,
  FolderPlus,
  FolderMinus,
  Shield,
  ShieldAlert,
  Bot,
  Download,
  RefreshCw,
  AlertTriangle,
  Banknote,
  Landmark,
  Coins,
  Users,
} from 'lucide-react'

export interface GraphNode {
  id: string
  group: number
}

export interface GraphLink {
  source: string | any
  target: string | any
  amount: number
  timestamp: string
  hop: number
  hop_level?: number
  ip_address?: string
  device_type?: string
  payment_mode?: string
  narration?: string
  transaction_narration?: string
}

export interface NetworkGraphProps {
  nodes: GraphNode[]
  links: GraphLink[]
  victimId?: string
  totalVolume?: number
  onNodeClick?: (node: GraphNode) => void
  onAskAI?: (accountId: string) => void
}

// Strict ID normalizer: strips leading/trailing whitespace and resolves object references
function cleanId(endpoint: any): string {
  if (typeof endpoint === 'object' && endpoint !== null && 'id' in endpoint) {
    return String(endpoint.id || '').trim()
  }
  return String(endpoint || '').trim()
}

// Robust timestamp parser supporting space or ISO separators
function parseTimestamp(ts: any): number | null {
  if (!ts) return null
  if (typeof ts === 'number') return isNaN(ts) ? null : ts
  const str = String(ts).trim()
  if (!str) return null
  const isoStr = str.includes(' ') ? str.replace(' ', 'T') : str
  const parsed = new Date(isoStr).getTime()
  return isNaN(parsed) ? null : parsed
}

// Map bank prefix to human-readable bank institution
function getBankName(accountId: string): string {
  const prefix = (cleanId(accountId) || '').slice(0, 4).toUpperCase()
  const map: Record<string, string> = {
    KKBK: 'Kotak Mahindra Bank',
    SBIN: 'State Bank of India',
    HDFC: 'HDFC Bank',
    ICIC: 'ICICI Bank',
    AXIS: 'Axis Bank',
    PUNB: 'Punjab National Bank',
    BARB: 'Bank of Baroda',
    PYTM: 'Paytm Payments Bank',
    AIRP: 'Airtel Payments Bank',
    IPOS: 'India Post Payments Bank',
    YESB: 'Yes Bank',
    UTIB: 'Axis Bank Ltd',
    CNRB: 'Canara Bank',
    UBIN: 'Union Bank of India',
  }
  return map[prefix] || 'Commercial Bank'
}

// Layer styling: Crisp White Cards with High-Contrast Forensics Color Coding
interface LayerStyle {
  border: string
  bg: string
  headerBg: string
  headerText: string
  badgeText: string
  dotColor: string
  edgeColor: string
  label: string
  badgeLabel: string
}

const LAYER_STYLES: Record<number, LayerStyle> = {
  [-1]: {
    border: 'border-emerald-400 hover:border-emerald-500',
    bg: 'bg-white',
    headerBg: 'bg-emerald-50 border-b border-emerald-100',
    headerText: 'text-emerald-900',
    badgeText: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    dotColor: '#10b981',
    edgeColor: '#059669',
    label: 'SOURCE OF FUNDS',
    badgeLabel: 'FEEDER',
  },
  0: {
    border: 'border-rose-400 hover:border-rose-500 ring-2 ring-rose-500/20',
    bg: 'bg-white',
    headerBg: 'bg-rose-50 border-b border-rose-100',
    headerText: 'text-rose-900',
    badgeText: 'bg-rose-100 text-rose-800 border-rose-200 font-bold',
    dotColor: '#f43f5e',
    edgeColor: '#f43f5e',
    label: 'TARGET HUB (SUSPECT)',
    badgeLabel: 'SUSPECT',
  },
  1: {
    border: 'border-indigo-400 hover:border-indigo-500',
    bg: 'bg-white',
    headerBg: 'bg-indigo-50 border-b border-indigo-100',
    headerText: 'text-indigo-900',
    badgeText: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    dotColor: '#6366f1',
    edgeColor: '#4f46e5',
    label: 'LAYER 1 MULE',
    badgeLabel: 'HOP 1',
  },
  2: {
    border: 'border-amber-400 hover:border-amber-500',
    bg: 'bg-white',
    headerBg: 'bg-amber-50 border-b border-amber-100',
    headerText: 'text-amber-900',
    badgeText: 'bg-amber-100 text-amber-800 border-amber-200',
    dotColor: '#f59e0b',
    edgeColor: '#d97706',
    label: 'LAYER 2 DISTRIBUTOR',
    badgeLabel: 'HOP 2',
  },
  3: {
    border: 'border-rose-400 hover:border-rose-500',
    bg: 'bg-white',
    headerBg: 'bg-rose-50 border-b border-rose-100',
    headerText: 'text-rose-900',
    badgeText: 'bg-rose-100 text-rose-800 border-rose-200 font-bold',
    dotColor: '#ef4444',
    edgeColor: '#e11d48',
    label: 'LAYER 3 TERMINAL',
    badgeLabel: 'HOP 3',
  },
  4: {
    border: 'border-purple-400 hover:border-purple-500',
    bg: 'bg-white',
    headerBg: 'bg-purple-50 border-b border-purple-100',
    headerText: 'text-purple-900',
    badgeText: 'bg-purple-100 text-purple-800 border-purple-200 font-bold',
    dotColor: '#a855f7',
    edgeColor: '#9333ea',
    label: 'LAYER 4 CASHOUT',
    badgeLabel: 'HOP 4',
  },
}

// --- CUSTOM NODE: CRISP WHITE CARD WITH INTERACTIVE EXPAND/COLLAPSE & SIDE PANEL INSPECTION ---
interface AccountNodeData {
  id: string
  group: number
  bankName: string
  flowAmount: number
  narration?: string
  childCount?: number
  isExpanded?: boolean
  isCashOut?: boolean
  cashOutType?: string
  cashOutIcon?: 'crypto' | 'atm' | 'forex' | 'cash' | 'terminal'
  inboundTotal?: number
  outboundTotal?: number
  retainedBalance?: number
  isFocused?: boolean
  onNodeInteraction?: (id: string, group: number, event: React.MouseEvent) => void
  onToggleExpand?: (id: string) => void
}

function AccountCardNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as AccountNodeData
  const group = typeof nodeData?.group === 'number' ? nodeData.group : 0
  const style = LAYER_STYLES[group] || LAYER_STYLES[1]
  const [copied, setCopied] = useState(false)

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (nodeData?.id) {
      navigator.clipboard.writeText(nodeData.id)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  const childCount = nodeData?.childCount || 0
  const isExpanded = !!nodeData?.isExpanded
  const hasChildren = childCount > 0
  const isCashOut = !!nodeData?.isCashOut
  const isFocused = !!nodeData?.isFocused

  // Dynamic icon for terminal cashout exit categories
  const CashIcon =
    nodeData.cashOutIcon === 'crypto' ? (
      <Coins className="h-3 w-3 text-amber-500 shrink-0" />
    ) : nodeData.cashOutIcon === 'atm' ? (
      <Banknote className="h-3 w-3 text-emerald-500 shrink-0" />
    ) : nodeData.cashOutIcon === 'forex' ? (
      <Globe className="h-3 w-3 text-sky-500 shrink-0" />
    ) : nodeData.cashOutIcon === 'cash' ? (
      <Banknote className="h-3 w-3 text-rose-500 shrink-0" />
    ) : (
      <Landmark className="h-3 w-3 text-rose-500 shrink-0" />
    )

  const formattedAmount = `₹${(nodeData.flowAmount || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

  return (
    <div
      onClick={(e) => {
        if (nodeData?.onNodeInteraction) {
          nodeData.onNodeInteraction(nodeData.id, group, e)
        }
      }}
      className={`forensic-node-enter relative rounded-xl border-2 transition-all duration-200 select-none cursor-pointer bg-white text-slate-800 shadow-sm hover:shadow-md ${
        isCashOut ? 'border-rose-400 hover:border-rose-500 ring-1 ring-rose-400/40' : style.border
      } ${
        isFocused
          ? 'ring-2 ring-indigo-500 ring-offset-2 scale-102 shadow-indigo-500/30 shadow-lg'
          : selected
          ? 'ring-2 ring-indigo-500 ring-offset-2 scale-102 shadow-indigo-500/20'
          : 'hover:scale-[1.01]'
      }`}
      style={{ width: 260, minHeight: 124 }}
    >
      {/* Target handle on LEFT edge for incoming money flow */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !bg-indigo-600 !border-2 !border-white !rounded-full -ml-1.5 shadow-xs transition-transform hover:scale-125"
      />

      {/* Top Header Strip with Tier Badge (Crisp pastel background) */}
      <div
        className={`px-2.5 py-1 flex items-center justify-between rounded-t-[10px] ${
          isCashOut ? 'bg-rose-50 border-b border-rose-100 text-rose-900' : style.headerBg
        }`}
      >
        <div className="flex items-center gap-1.5 overflow-hidden">
          <span
            className="h-2 w-2 rounded-full shrink-0 animate-pulse"
            style={{ backgroundColor: isCashOut ? '#ef4444' : style.dotColor }}
          />
          <div className="flex items-center gap-1 text-[10px] font-mono font-bold tracking-tight uppercase truncate">
            {isCashOut ? (
              <>
                {CashIcon}
                <span className="truncate">{nodeData.cashOutType || 'TERMINAL EXIT'}</span>
              </>
            ) : (
              <span className={`truncate ${style.headerText}`}>
                {group === -1
                  ? 'SOURCE OF FUNDS'
                  : group === 0
                  ? 'TARGET HUB (SUSPECT)'
                  : style.label}
              </span>
            )}
          </div>
        </div>
        <span
          className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded border shrink-0 ${
            isCashOut ? 'bg-rose-100 text-rose-800 border-rose-200' : style.badgeText
          }`}
        >
          {isCashOut ? 'TERMINAL' : style.badgeLabel}
        </span>
      </div>

      {/* Card Body: flex-col gap-1.5 for clean line-by-line layout */}
      <div className="px-2.5 py-2 flex flex-col gap-1 bg-white rounded-b-[10px]">
        {/* Line 1: Account ID + Copy Action */}
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs font-black tracking-tight text-slate-900 truncate max-w-[190px]" title={nodeData.id}>
            {nodeData.id}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="p-0.5 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer shrink-0"
            title="Copy Account ID"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>

        {/* Line 2: Bank Institution Name */}
        <div className="flex items-center gap-1 text-[10px] text-slate-500 font-sans">
          <Building className="h-2.5 w-2.5 text-slate-400 shrink-0" />
          <span className="truncate" title={nodeData.bankName}>
            {nodeData.bankName}
          </span>
        </div>

        {/* Line 3: Flow Amount in INR with direction-coded color */}
        <div className="flex items-center justify-between text-[11px] font-mono border-t border-slate-100 pt-1">
          <span className="text-slate-400 text-[9px] font-medium">
            {group === -1 ? 'In:' : group === 0 ? 'Vol:' : 'Out:'}
          </span>
          <span className={`font-extrabold ${
            group === -1
              ? 'text-emerald-600'
              : group === 0
              ? 'text-rose-700'
              : isCashOut
              ? 'text-rose-600'
              : 'text-indigo-700'
          }`}>
            {formattedAmount}
          </span>
        </div>

        {/* Line 4: Narration with line-clamp-1 to prevent overflow */}
        <div className="flex items-center gap-1 text-[9px] text-slate-400 font-sans">
          <FileText className="h-2.5 w-2.5 text-slate-300 shrink-0" />
          <span className="truncate" title={nodeData.narration || 'Forensic Transfer Relay'}>
            {nodeData.narration || 'Forensic Transfer Relay'}
          </span>
        </div>
      </div>

      {/* Source handle on RIGHT edge for outgoing money flow */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !bg-indigo-600 !border-2 !border-white !rounded-full -mr-1.5 shadow-xs transition-transform hover:scale-125"
      />

      {/* Interactive Expand / Collapse Toggle Pill */}
      {hasChildren && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            if (nodeData?.onToggleExpand) {
              nodeData.onToggleExpand(nodeData.id)
            }
          }}
          className={`absolute -right-3.5 top-1/2 -translate-y-1/2 z-30 flex items-center justify-center rounded-full border shadow-md transition-all duration-150 cursor-pointer ${
            isExpanded
              ? 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200 h-6 w-6'
              : 'bg-indigo-600 text-white border-indigo-500 hover:bg-indigo-700 h-6 px-1.5 font-bold shadow-sm shadow-indigo-600/30'
          }`}
          title={isExpanded ? `Collapse ${childCount} child nodes` : `Expand ${childCount} child nodes`}
        >
          {isExpanded ? (
            <Minus className="h-3.5 w-3.5" />
          ) : (
            <div className="flex items-center gap-0.5 text-[10px] font-mono font-bold leading-none">
              <Plus className="h-3 w-3 stroke-[2.5]" />
              <span>{childCount}</span>
            </div>
          )}
        </button>
      )}
    </div>
  )
}

// --- CUSTOM EDGE: SMOOTH BEZIER CURVE WITH CRISP WHITE LABEL BADGE ---
interface MoneyFlowEdgeData {
  amount: number
  formattedAmount: string
  timestamp: string
  hop: number
  index?: number
  ip_address?: string
  device_type?: string
  payment_mode?: string
  narration?: string
  transaction_narration?: string
  sourceId: string
  targetId: string
  onEdgeClick?: (data: MoneyFlowEdgeData, event: React.MouseEvent) => void
}

function MoneyFlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style = {},
  markerEnd,
}: EdgeProps) {
  // Sweeping organic Bezier curve directly connecting parent right handle to child left handle
  const deltaY = Math.abs(targetY - sourceY)
  const curvature = deltaY > 300 ? 0.38 : deltaY > 150 ? 0.32 : 0.28

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition: Position.Right,
    targetX,
    targetY,
    targetPosition: Position.Left,
    curvature,
  })

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      style={{
        ...style,
        strokeDasharray: '6 4',
        animation: 'moneyFlowAnim 0.85s linear infinite',
      }}
      markerEnd={markerEnd}
    />
  )
}

const NODE_TYPES = {
  accountCard: AccountCardNode,
}

const EDGE_TYPES = {
  bezier: MoneyFlowEdge,
  default: MoneyFlowEdge,
  smoothstep: MoneyFlowEdge,
}

// Floating Tooltip State
interface TooltipState {
  type: 'node' | 'edge'
  data: any
}

// Phase 4: Notice Generation State
interface NoticeTarget {
  accountId: string
  bankName: string
  amount: number
  isBulk?: boolean
  connectedAccounts?: string[]
}

// Phase 5: Deep Forensic Node Detail State
interface SelectedNodeDetail {
  id: string
  group: number
  bankName: string
  flowAmount: number
  inboundTotal: number
  outboundTotal: number
  retainedBalance: number
  inboundCount: number
  outboundCount: number
  inboundLinks: GraphLink[]
  outboundLinks: GraphLink[]
  narration: string
  ipAddress?: string
  deviceType?: string
  paymentMode?: string
  downstreamAccounts: string[]
}

function NetworkGraphInner({
  nodes,
  links,
  victimId: _victimId,
  totalVolume: _totalVolume,
  onNodeClick: _onNodeClick,
  onAskAI,
}: NetworkGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const nodeTypes = useMemo(() => NODE_TYPES, [])
  const edgeTypes = useMemo(() => EDGE_TYPES, [])

  // Floating draggable popup state
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(null)
  const [isDraggingPopup, setIsDraggingPopup] = useState(false)
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; initialX: number; initialY: number }>({
    mouseX: 0,
    mouseY: 0,
    initialX: 0,
    initialY: 0,
  })

  // Phase 4 Legal Drawer state
  const [isNoticeDrawerOpen, setIsNoticeDrawerOpen] = useState(false)
  const [activeNoticeTarget, setActiveNoticeTarget] = useState<NoticeTarget | null>(null)
  const [editableNoticeText, setEditableNoticeText] = useState('')
  const [isLoadingNotice, setIsLoadingNotice] = useState(false)
  const [noticeError, setNoticeError] = useState<string | null>(null)
  const [copiedNotice, setCopiedNotice] = useState(false)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const [highlightedPathNodeId, setHighlightedPathNodeId] = useState<string | null>(null)

  // Phase 5: Slide-in Node Detail Side Panel State
  const [selectedNodeDetail, setSelectedNodeDetail] = useState<SelectedNodeDetail | null>(null)

  // React Flow instance hooks
  const { fitView, getNode, setCenter } = useReactFlow()
  const isInitialFitDoneRef = useRef(false)

  // Normalize incoming nodes with clean IDs and robust group extraction
  const cleanVictimId = cleanId(_victimId)

  // Normalize incoming nodes with clean IDs, authoritative root first, and complete unique collection
  const normalizedNodes = useMemo(() => {
    const nodeMap = new Map<string, GraphNode>()

    // 1. Map Root Node FIRST
    if (cleanVictimId) {
      nodeMap.set(cleanVictimId, { id: cleanVictimId, group: 0 })
    }

    // 2. Map all explicitly provided nodes
    nodes.forEach((n) => {
      const id = cleanId(n.id)
      if (!id) return
      let g = 0
      if (cleanVictimId && id === cleanVictimId) {
        g = 0
      } else if (typeof n.group === 'number') {
        g = n.group
      } else if (n.group !== undefined && !isNaN(Number(n.group))) {
        g = Number(n.group)
      } else if ((n as any).hop !== undefined && !isNaN(Number((n as any).hop))) {
        g = Number((n as any).hop)
      } else if ((n as any).hop_level !== undefined && !isNaN(Number((n as any).hop_level))) {
        g = Number((n as any).hop_level)
      }
      nodeMap.set(id, { ...n, id, group: g })
    })

    // 3. Infer missing endpoints from links so NO nodes or hops are ever dropped
    links.forEach((l) => {
      const s = cleanId(l.source)
      const t = cleanId(l.target)
      let linkHop = 1
      if (typeof l.hop === 'number') linkHop = l.hop
      else if (typeof l.hop_level === 'number') linkHop = l.hop_level
      else if (l.hop !== undefined && !isNaN(Number(l.hop))) linkHop = Number(l.hop)
      else if (l.hop_level !== undefined && !isNaN(Number(l.hop_level))) linkHop = Number(l.hop_level)

      if (s && !nodeMap.has(s)) {
        const sGroup = cleanVictimId && s === cleanVictimId ? 0 : linkHop === -1 ? -1 : Math.max(0, linkHop - 1)
        nodeMap.set(s, { id: s, group: sGroup })
      }
      if (t && !nodeMap.has(t)) {
        const tGroup = cleanVictimId && t === cleanVictimId ? 0 : linkHop === -1 ? 0 : linkHop
        nodeMap.set(t, { id: t, group: tGroup })
      }
    })

    // Guarantee root node group 0 if no victim ID was given
    if (!cleanVictimId && nodeMap.size > 0) {
      const existingRoot = Array.from(nodeMap.values()).find((n) => n.group === 0) || Array.from(nodeMap.values())[0]
      if (existingRoot) {
        nodeMap.set(existingRoot.id, { ...existingRoot, group: 0 })
      }
    }

    return Array.from(nodeMap.values())
  }, [nodes, links, cleanVictimId])

  // Normalize incoming links with clean IDs and robust hop depth
  const normalizedLinks = useMemo(() => {
    return links
      .map((l) => {
        let h = 1
        if (typeof l.hop === 'number') h = l.hop
        else if (typeof l.hop_level === 'number') h = l.hop_level
        else if (l.hop !== undefined && !isNaN(Number(l.hop))) h = Number(l.hop)
        else if (l.hop_level !== undefined && !isNaN(Number(l.hop_level))) h = Number(l.hop_level)
        return {
          ...l,
          source: cleanId(l.source),
          target: cleanId(l.target),
          amount: Number(l.amount) || 0,
          hop: h,
          hop_level: h,
        }
      })
      .filter((l) => l.source !== '' && l.target !== '')
  }, [links])

  // Locate the authoritative Root Victim node
  const rootNode = useMemo(() => {
    return (
      normalizedNodes.find((n) => n.group === 0) ||
      normalizedNodes.find((n) => n.id === cleanVictimId) ||
      normalizedNodes[0]
    )
  }, [normalizedNodes, cleanVictimId])

  const rootId = rootNode ? cleanId(rootNode.id) : cleanVictimId

  // --- AUTO-EXPAND ON MOUNT: ALL LAYERS (1, 2, 3) EXPANDED IMMEDIATELY ---
  // We track collapsedNodeIds (explicitly collapsed nodes). By default empty = 100% of layers expanded!
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(new Set())

  // Reset collapsed nodes whenever new dataset is loaded
  useEffect(() => {
    setCollapsedNodeIds(new Set())
    setHighlightedPathNodeId(null)
    setSelectedNodeDetail(null)
    isInitialFitDoneRef.current = false
  }, [rootId, normalizedLinks, normalizedNodes])

  // Computed expandedNodeIds for card body buttons & compatibility
  const expandedNodeIds = useMemo(() => {
    const all = new Set<string>()
    normalizedNodes.forEach((n) => {
      if (!collapsedNodeIds.has(n.id)) all.add(n.id)
    })
    normalizedLinks.forEach((l) => {
      if (!collapsedNodeIds.has(l.source)) all.add(l.source)
    })
    return all
  }, [normalizedNodes, normalizedLinks, collapsedNodeIds])

  // Build parent-to-child and incoming links lookup maps with clean IDs
  const { childMap, incomingLinksByTarget } = useMemo(() => {
    const children: Record<string, Set<string>> = {}
    const incoming: Record<string, GraphLink[]> = {}

    normalizedLinks.forEach((l) => {
      const s = cleanId(l.source)
      const t = cleanId(l.target)
      if (!s || !t) return

      if (!children[s]) children[s] = new Set()
      children[s].add(t)

      if (!incoming[t]) incoming[t] = []
      incoming[t].push(l)
    })

    return { childMap: children, incomingLinksByTarget: incoming }
  }, [normalizedLinks])

  // --- BFS TRAVERSAL ENGINE TO COLLECT ALL DOWNSTREAM DESCENDANTS ---
  const getDownstreamDescendants = useCallback(
    (startId: string): string[] => {
      const cleanStart = cleanId(startId)
      const descendants: string[] = []
      const queue: string[] = [cleanStart]
      const visited = new Set<string>([cleanStart])

      while (queue.length > 0) {
        const curr = queue.shift()!
        const children = childMap[curr]
        if (children) {
          children.forEach((childId) => {
            const cleanChild = cleanId(childId)
            if (!visited.has(cleanChild)) {
              visited.add(cleanChild)
              descendants.push(cleanChild)
              queue.push(cleanChild)
            }
          })
        }
      }

      return descendants
    },
    [childMap]
  )

  // Autoplay step state (number of chronological links revealed)
  const [autoplayCount, setAutoplayCount] = useState<number | null>(null)
  const [isPlaying, setIsPlaying] = useState<boolean>(false)
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1) // 0.5x, 1x, 2x, 5x

  // Causal and chronological sorted links for organic autoplay playback:
  const sortedLinks = useMemo(() => {
    return [...normalizedLinks].sort((a, b) => {
      const hopA = a.hop || 1
      const hopB = b.hop || 1
      if (hopA !== hopB) return hopA - hopB

      const ta = parseTimestamp(a.timestamp) ?? 0
      const tb = parseTimestamp(b.timestamp) ?? 0
      return ta - tb
    })
  }, [normalizedLinks])

  // Toggle individual node expansion
  const handleToggleNodeExpand = useCallback((nodeId: string) => {
    const clean = cleanId(nodeId)
    setAutoplayCount(null)
    setCollapsedNodeIds((prev) => {
      const next = new Set(prev)
      if (next.has(clean)) {
        next.delete(clean) // was collapsed, now expand
      } else {
        next.add(clean) // was expanded, now collapse
      }
      return next
    })
  }, [])

  // Global Expand All: reveal all Hop 1, 2, and 3 nodes
  const handleExpandAll = useCallback(() => {
    setAutoplayCount(null)
    setCollapsedNodeIds(new Set())
  }, [])

  // Global Collapse to Root: collapse everything except root
  const handleCollapseToRoot = useCallback(() => {
    setAutoplayCount(null)
    const collapsed = new Set<string>()
    normalizedNodes.forEach((n) => {
      if (n.id !== rootId && n.group !== -1) collapsed.add(n.id)
    })
    normalizedLinks.forEach((l) => {
      if (l.source !== rootId && l.hop !== -1) collapsed.add(l.source)
    })
    setCollapsedNodeIds(collapsed)
  }, [rootId, normalizedNodes, normalizedLinks])

  // Fullscreen toggle handler with HTML5 API fallback
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      if (containerRef.current?.requestFullscreen) {
        containerRef.current
          .requestFullscreen()
          .then(() => setIsFullscreen(true))
          .catch(() => setIsFullscreen((prev) => !prev))
      } else {
        setIsFullscreen((prev) => !prev)
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {})
      }
      setIsFullscreen(false)
    }
  }

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', handleFsChange)
    return () => document.removeEventListener('fullscreenchange', handleFsChange)
  }, [])

  // Dragging interaction logic for popup
  const handleDragHandleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!popupPos) return
    setIsDraggingPopup(true)
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      initialX: popupPos.x,
      initialY: popupPos.y,
    }
  }

  useEffect(() => {
    if (!isDraggingPopup) return

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartRef.current.mouseX
      const dy = e.clientY - dragStartRef.current.mouseY
      const containerRect = containerRef.current?.getBoundingClientRect()
      const maxX = (containerRect?.width || 800) - 340
      const maxY = (containerRect?.height || 600) - 310

      setPopupPos({
        x: Math.max(10, Math.min(maxX, dragStartRef.current.initialX + dx)),
        y: Math.max(10, Math.min(maxY, dragStartRef.current.initialY + dy)),
      })
    }

    const handleMouseUp = () => {
      setIsDraggingPopup(false)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDraggingPopup])

  // Time metrics across links
  const timeMetrics = useMemo(() => {
    const validTimes = normalizedLinks
      .map((l) => parseTimestamp(l.timestamp))
      .filter((t): t is number => t !== null)

    if (validTimes.length === 0) {
      const now = Date.now()
      return {
        min: now - 86400000,
        max: now,
        hasTimes: false,
      }
    }

    const min = Math.min(...validTimes)
    const max = Math.max(...validTimes)
    return {
      min,
      max: min === max ? min + 60000 : max,
      hasTimes: true,
    }
  }, [normalizedLinks])

  // Time-travel scrubber state (activeHorizon)
  const [activeHorizon, setActiveHorizon] = useState<number>(timeMetrics.max)
  const sliderTime = activeHorizon
  const setSliderTime = setActiveHorizon

  // Reset slider whenever new dataset is loaded
  useEffect(() => {
    setActiveHorizon(timeMetrics.max)
    setIsPlaying(false)
    setAutoplayCount(null)
    setTooltip(null)
    setPopupPos(null)
    setHighlightedPathNodeId(null)
  }, [timeMetrics.min, timeMetrics.max])

  // Explicit unmount cleanup for garbage collection and memory leak prevention
  useEffect(() => {
    return () => {
      setTooltip(null)
      setPopupPos(null)
      setHoveredNodeId(null)
      setHighlightedPathNodeId(null)
      setIsNoticeDrawerOpen(false)
      setActiveNoticeTarget(null)
    }
  }, [])

  // Variable speed mapping in milliseconds:
  const autoplayIntervalMs = useMemo(() => {
    if (playbackSpeed === 0.5) return 2000
    if (playbackSpeed === 1) return 1000
    if (playbackSpeed === 2) return 400
    return 150
  }, [playbackSpeed])

  // Autoplay toggle trigger
  const handleTogglePlay = () => {
    if (!isPlaying) {
      if (autoplayCount === null || autoplayCount >= sortedLinks.length) {
        setAutoplayCount(1)
      }
      setIsPlaying(true)
    } else {
      setIsPlaying(false)
    }
  }

  // Chronological autoplay engine:
  useEffect(() => {
    if (!isPlaying) return

    if (sortedLinks.length === 0) {
      setIsPlaying(false)
      return
    }

    const interval = setInterval(() => {
      setAutoplayCount((prev) => {
        const current = prev ?? 0
        if (current >= sortedLinks.length) {
          setIsPlaying(false)
          return sortedLinks.length
        }
        const next = current + 1
        if (next >= sortedLinks.length) {
          setIsPlaying(false)
        }
        return next
      })
    }, autoplayIntervalMs)

    return () => clearInterval(interval)
  }, [isPlaying, autoplayIntervalMs, sortedLinks])

  // Keep activeHorizon synchronized with autoplay progress
  useEffect(() => {
    if (autoplayCount !== null && autoplayCount > 0 && autoplayCount <= sortedLinks.length) {
      const activeLink = sortedLinks[autoplayCount - 1]
      if (activeLink) {
        const t = parseTimestamp(activeLink.timestamp)
        if (t !== null) {
          setActiveHorizon(t)
        }
      }
    }
  }, [autoplayCount, sortedLinks])

  // --- STRICT SYNCHRONIZED GRAPH FILTER ENGINE (FULL 4-HOP TRAVERSAL & REAL-TIME TIME-SCRUBBING) ---
  const { filteredLinks, visibleNodes } = useMemo(() => {
    // Mode A: Autoplay step-by-step chronological animation
    if (autoplayCount !== null && autoplayCount > 0) {
      const activeLinks = sortedLinks.slice(0, autoplayCount)
      const activeIdSet = new Set<string>()
      if (rootId) activeIdSet.add(rootId)
      activeLinks.forEach((l) => {
        activeIdSet.add(cleanId(l.source))
        activeIdSet.add(cleanId(l.target))
      })
      const finalNodes = normalizedNodes.filter((n) => activeIdSet.has(cleanId(n.id)))
      return { filteredLinks: activeLinks, visibleNodes: finalNodes }
    }

    // Mode B: Interactive Tree & Real-Time Timeline Scrubber
    // Calculate hidden descendants if any nodes are explicitly collapsed
    const hiddenNodeIds = new Set<string>()
    if (collapsedNodeIds.size > 0) {
      collapsedNodeIds.forEach((collapsedId) => {
        const descendants = getDownstreamDescendants(collapsedId)
        descendants.forEach((d) => hiddenNodeIds.add(d))
      })
    }

    // Filter links: exclude links involving collapsed/hidden nodes and filter by time scrubber
    const finalLinksMap = new Map<string, GraphLink>()
    normalizedLinks.forEach((l) => {
      const s = cleanId(l.source)
      const t = cleanId(l.target)
      if (hiddenNodeIds.has(s) || hiddenNodeIds.has(t)) return
      if (collapsedNodeIds.has(s)) return

      if (timeMetrics.hasTimes && activeHorizon < timeMetrics.max) {
        const linkTime = parseTimestamp(l.timestamp)
        if (linkTime !== null && linkTime > activeHorizon) {
          return
        }
      }
      finalLinksMap.set(`${s}->${t}-${l.timestamp || ''}`, l)
    })

    const finalLinks = Array.from(finalLinksMap.values())

    // Active nodes connected to visible links, plus root & source of funds
    const activeNodeIds = new Set<string>()
    if (rootId) activeNodeIds.add(rootId)

    finalLinks.forEach((l) => {
      activeNodeIds.add(cleanId(l.source))
      activeNodeIds.add(cleanId(l.target))
    })

    const isFullLedger = !timeMetrics.hasTimes || activeHorizon >= timeMetrics.max
    const finalNodes = normalizedNodes.filter((n) => {
      const id = cleanId(n.id)
      if (hiddenNodeIds.has(id)) return false
      if (isFullLedger) return true
      return activeNodeIds.has(id) || n.group === 0 || n.group === -1
    })

    return { filteredLinks: finalLinks, visibleNodes: finalNodes }
  }, [
    autoplayCount,
    sortedLinks,
    rootId,
    collapsedNodeIds,
    normalizedLinks,
    normalizedNodes,
    timeMetrics.hasTimes,
    timeMetrics.max,
    activeHorizon,
    getDownstreamDescendants,
  ])

  // Cumulative visible transfer volume
  const visibleVolume = useMemo(() => {
    return filteredLinks.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0)
  }, [filteredLinks])

  // Formatted date string for the HUD overlay
  const formattedOverlayDate = useMemo(() => {
    if (!timeMetrics.hasTimes) return 'Full Historical Ledger'
    const d = new Date(sliderTime)
    if (isNaN(d.getTime())) return 'Invalid Time'
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }, [sliderTime, timeMetrics.hasTimes])

  // Retained balance for Target Hub (Inbound - Outbound)
  const targetRetainedBalance = useMemo(() => {
    if (!rootId) return null
    const cleanR = cleanId(rootId)
    const inSum = normalizedLinks
      .filter((l) => cleanId(l.target) === cleanR)
      .reduce((a, c) => a + (Number(c.amount) || 0), 0)
    const outSum = normalizedLinks
      .filter((l) => cleanId(l.source) === cleanR)
      .reduce((a, c) => a + (Number(c.amount) || 0), 0)
    return Math.round((inSum - outSum) * 100) / 100
  }, [rootId, normalizedLinks])

  // --- PHASE 4: TRIGGER SECTION 91 NOTICE GENERATION & OPEN DRAWER ---
  const handleDraftNotice = useCallback(
    async (
      accountId: string,
      bankName: string,
      connectedAccounts?: string[],
      isBulk?: boolean,
      overrideAmount?: number
    ) => {
      const cleanTarget = cleanId(accountId)
      if (!cleanTarget) return

      const inbound = normalizedLinks.filter((l) => cleanId(l.target) === cleanTarget)
      const totalIn = inbound.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0)
      const outbound = normalizedLinks.filter((l) => cleanId(l.source) === cleanTarget)
      const totalOut = outbound.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0)
      const targetAmt = overrideAmount || (totalIn > 0 ? totalIn : totalOut > 0 ? totalOut : 50000)

      const targetBank = bankName || getBankName(cleanTarget)

      setActiveNoticeTarget({
        accountId: cleanTarget,
        bankName: targetBank,
        amount: targetAmt,
        isBulk: !!isBulk,
        connectedAccounts,
      })

      setIsNoticeDrawerOpen(true)
      setIsLoadingNotice(true)
      setNoticeError(null)
      setEditableNoticeText('')
      setCopiedNotice(false)

      try {
        const token = sessionStorage.getItem('officer_token')
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (token) {
          headers['Authorization'] = `Bearer ${token}`
        }

        const res = await fetch('/api/generate-notice', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            account_id: cleanTarget,
            bank_name: targetBank,
            amount: targetAmt,
            connected_accounts: connectedAccounts && connectedAccounts.length > 0 ? connectedAccounts : undefined,
            is_bulk: !!isBulk,
          }),
        })

        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}))
          throw new Error(errJson.detail || `Legal drafting request failed with status ${res.status}`)
        }

        const data = await res.json()
        const draftedText = data.notice || ''
        setEditableNoticeText(draftedText)
      } catch (err: unknown) {
        setNoticeError(err instanceof Error ? err.message : 'Failed to generate Section 91 notice.')
      } finally {
        setIsLoadingNotice(false)
      }
    },
    [normalizedLinks]
  )

  // PHASE 4: OFFICIAL EVIDENTIARY PDF EXPORT (SEC 91 & TRANSACTION LEDGER)
  const handleDownloadPDF = () => {
    if (!activeNoticeTarget) return

    const cleanTarget = cleanId(activeNoticeTarget.accountId)
    // Extract Layer 1 flows: direct outbound transfers from target account or hop === 1
    const targetOutflows = normalizedLinks.filter((l) => cleanId(l.source) === cleanTarget)
    const l1Links = normalizedLinks.filter((l) => cleanId(l.source) === cleanTarget || l.hop === 1 || l.hop_level === 1)
    const effectiveFlows =
      targetOutflows.length > 0 ? targetOutflows : l1Links.length > 0 ? l1Links : normalizedLinks.slice(0, 50)

    downloadFreezeReportPDF({
      targetAccountId: cleanTarget,
      targetBankName: activeNoticeTarget.bankName,
      totalDispersalAmount: activeNoticeTarget.amount,
      layer1Flows: effectiveFlows.map((l) => ({
        source: cleanId(l.source),
        target: cleanId(l.target),
        amount: Number(l.amount) || 0,
        timestamp: l.timestamp,
        narration: l.transaction_narration || l.narration,
        ip_address: l.ip_address,
        device_type: l.device_type,
        payment_mode: l.payment_mode,
        hop: l.hop,
      })),
      customNoticeText: editableNoticeText || undefined,
    })
  }

  // Copy notice text to clipboard
  const handleCopyNotice = () => {
    if (!editableNoticeText) return
    navigator.clipboard.writeText(editableNoticeText)
    setCopiedNotice(true)
    setTimeout(() => setCopiedNotice(false), 2000)
  }

  // Node path selection handler (triggers root-to-leaf path tracing)
  const handleNodePathClick = useCallback(
    (nodeId: string) => {
      const cleanTarget = cleanId(nodeId)
      setHighlightedPathNodeId(cleanTarget)
      if (_onNodeClick) {
        const rawNode = normalizedNodes.find((n) => cleanId(n.id) === cleanTarget)
        if (rawNode) _onNodeClick(rawNode)
      }
    },
    [normalizedNodes, _onNodeClick]
  )

  // Node Click interaction handler: slides in the Node Detail Side Panel without auto-triggering notice drafting
  const handleNodeInteraction = useCallback(
    (nodeId: string, group: number, _e: React.MouseEvent) => {
      const cleanTarget = cleanId(nodeId)
      handleNodePathClick(cleanTarget)

      const inbound = normalizedLinks.filter((l) => cleanId(l.target) === cleanTarget)
      const outbound = normalizedLinks.filter((l) => cleanId(l.source) === cleanTarget)
      const totalIn = inbound.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0)
      const totalOut = outbound.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0)
      const retained = Math.round((totalIn - totalOut) * 100) / 100
      const flowAmount = totalIn > 0 ? totalIn : totalOut > 0 ? totalOut : 0
      const sampleNarration =
        inbound[0]?.transaction_narration ||
        inbound[0]?.narration ||
        outbound[0]?.transaction_narration ||
        outbound[0]?.narration ||
        ''

      const downstream = getDownstreamDescendants(cleanTarget)

      setSelectedNodeDetail({
        id: cleanTarget,
        group,
        bankName: getBankName(cleanTarget),
        flowAmount,
        inboundTotal: totalIn,
        outboundTotal: totalOut,
        retainedBalance: retained,
        inboundCount: inbound.length,
        outboundCount: outbound.length,
        inboundLinks: inbound,
        outboundLinks: outbound,
        narration: sampleNarration,
        ipAddress: inbound[0]?.ip_address || outbound[0]?.ip_address,
        deviceType: inbound[0]?.device_type || outbound[0]?.device_type,
        paymentMode: inbound[0]?.payment_mode || outbound[0]?.payment_mode,
        downstreamAccounts: downstream,
      })

      // Close floating draggable popup if open to focus on the inspector drawer
      setTooltip(null)
      setPopupPos(null)
    },
    [normalizedLinks, getDownstreamDescendants, handleNodePathClick]
  )

  // Edge Click interaction handler
  const handleEdgeInteraction = useCallback(
    (edgeData: MoneyFlowEdgeData, e: React.MouseEvent) => {
      const containerRect = containerRef.current?.getBoundingClientRect()
      if (!containerRect) return

      let x = e.clientX - containerRect.left + 15
      let y = e.clientY - containerRect.top + 15

      const cardWidth = 330
      const cardHeight = 300

      if (x + cardWidth > containerRect.width) {
        x = Math.max(10, e.clientX - containerRect.left - cardWidth - 15)
      }
      if (y + cardHeight > containerRect.height) {
        y = Math.max(10, e.clientY - containerRect.top - cardHeight - 15)
      }

      setTooltip({
        type: 'edge',
        data: edgeData,
      })
      setPopupPos({ x, y })
    },
    []
  )

  // Export Syndicate Data (CSV) for currently isolated subgraph
  const handleExportSyndicateCSV = useCallback(() => {
    if (!selectedNodeDetail) return
    const syndicateSet = new Set([
      selectedNodeDetail.id,
      ...selectedNodeDetail.downstreamAccounts,
    ])
    const relevantLinks = normalizedLinks.filter(
      (l) => syndicateSet.has(cleanId(l.source)) || syndicateSet.has(cleanId(l.target))
    )
    const headers = [
      'Source_Account',
      'Target_Account',
      'Amount_INR',
      'Hop_Level',
      'Timestamp',
      'IP_Address',
      'Device_Type',
      'Payment_Mode',
      'Narration',
    ]
    const rows = relevantLinks.map((l) => [
      cleanId(l.source),
      cleanId(l.target),
      l.amount,
      l.hop,
      `"${l.timestamp || ''}"`,
      `"${l.ip_address || ''}"`,
      `"${l.device_type || ''}"`,
      `"${l.payment_mode || ''}"`,
      `"${(l.transaction_narration || l.narration || '').replace(/"/g, '""')}"`,
    ])
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.setAttribute('href', url)
    a.setAttribute('download', `Syndicate_Data_${selectedNodeDetail.id}.csv`)
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [selectedNodeDetail, normalizedLinks])

  // --- RECURSIVE FUNCTION: TRACE BACKWARDS FROM TARGET NODE TO ROOT ANCHOR ---
  const findPathToRoot = useCallback(
    (targetNodeId: string) => {
      const cleanTarget = cleanId(targetNodeId)
      const pathNodeIds = new Set<string>([cleanTarget])
      const pathEdgeIds = new Set<string>()

      // Backward traversal queue to Root Anchor and Hop -1 Feeders
      const queue = [cleanTarget]
      const visited = new Set<string>([cleanTarget])

      while (queue.length > 0) {
        const curr = queue.shift()!
        filteredLinks.forEach((link, idx) => {
          const s = cleanId(link.source)
          const t = cleanId(link.target)
          if (t === curr) {
            pathNodeIds.add(s)
            pathEdgeIds.add(`e-${s}->${t}-${idx}`)
            if (!visited.has(s)) {
              visited.add(s)
              queue.push(s)
            }
          }
        })
      }

      return { pathNodeIds, pathEdgeIds }
    },
    [filteredLinks]
  )

  // --- ROOT-TO-LEAF PATH TRACING & HOVER FOCUS ENGINE ---
  const activeHighlight = useMemo(() => {
    if (highlightedPathNodeId) {
      const cleanSelected = cleanId(highlightedPathNodeId)
      const rootTrace = findPathToRoot(cleanSelected)
      const pathNodeIds = new Set<string>(rootTrace.pathNodeIds)
      const pathEdgeIds = new Set<string>(rootTrace.pathEdgeIds)

      // Forward traversal to downstream leaves / terminal children
      const forwardQueue = [cleanSelected]
      const forwardVisited = new Set<string>([cleanSelected])

      while (forwardQueue.length > 0) {
        const curr = forwardQueue.shift()!
        filteredLinks.forEach((link, idx) => {
          const s = cleanId(link.source)
          const t = cleanId(link.target)
          if (s === curr) {
            pathNodeIds.add(t)
            pathEdgeIds.add(`e-${s}->${t}-${idx}`)
            if (!forwardVisited.has(t)) {
              forwardVisited.add(t)
              forwardQueue.push(t)
            }
          }
        })
      }

      return { pathNodeIds, pathEdgeIds }
    }

    if (hoveredNodeId) {
      const cleanHovered = cleanId(hoveredNodeId)
      return findPathToRoot(cleanHovered)
    }

    return null
  }, [highlightedPathNodeId, hoveredNodeId, findPathToRoot, filteredLinks])

  // --- CRITICAL ELK LAYOUT ENGINE (ANTI-COLLISION LAYERED EXPANSION & ZERO OVERLAPS) ---
  const CARD_WIDTH = 260
  const CARD_HEIGHT = 130

  const ANCHOR_X = 1100
  const ANCHOR_Y = 400

  // Columnar default positions per hop level with vertical centering and zero collisions
  const defaultPositions = useMemo(() => {
    const posMap: Record<string, { x: number; y: number }> = {}
    const groupCounts: Record<number, number> = {}
    visibleNodes.forEach((n) => {
      groupCounts[n.group] = (groupCounts[n.group] || 0) + 1
    })

    const groupCounters: Record<number, number> = {}
    visibleNodes.forEach((n) => {
      const g = n.group
      const idx = groupCounters[g] || 0
      groupCounters[g] = idx + 1
      const totalInGroup = groupCounts[g] || 1

      // Clean horizontal column spacing:
      // Hop -1: x = ANCHOR_X - 420
      // Hop 0:  x = ANCHOR_X
      // Hop 1:  x = ANCHOR_X + 420
      // Hop 2:  x = ANCHOR_X + 840
      // Hop 3:  x = ANCHOR_X + 1260
      // Hop 4:  x = ANCHOR_X + 1680
      const x = ANCHOR_X + (g === -1 ? -420 : g * 420)
      const y = ANCHOR_Y + (idx - (totalInGroup - 1) / 2) * 160
      posMap[cleanId(n.id)] = { x, y }
    })
    return posMap
  }, [visibleNodes])

  const [layoutPositions, setLayoutPositions] = useState<Record<string, { x: number; y: number }>>({})
  const prevLayoutKeyRef = useRef<string>('')

  const layoutKey = useMemo(() => {
    const nStr = visibleNodes.map((n) => cleanId(n.id)).sort().join(',')
    const lStr = filteredLinks.map((l) => `${cleanId(l.source)}->${cleanId(l.target)}`).sort().join(',')
    return `${nStr}#${lStr}`
  }, [visibleNodes, filteredLinks])

  useEffect(() => {
    if (visibleNodes.length === 0) return
    if (prevLayoutKeyRef.current === layoutKey) return
    prevLayoutKeyRef.current = layoutKey

    let isCancelled = false

    const elkChildren = visibleNodes.map((n) => {
      const nId = cleanId(n.id)
      return {
        id: nId,
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
      }
    })

    const visibleIdSet = new Set(visibleNodes.map((n) => cleanId(n.id)))
    const elkEdges = filteredLinks
      .filter((l) => visibleIdSet.has(cleanId(l.source)) && visibleIdSet.has(cleanId(l.target)))
      .map((l, idx) => ({
        id: `e-${cleanId(l.source)}->${cleanId(l.target)}-${idx}`,
        sources: [cleanId(l.source)],
        targets: [cleanId(l.target)],
      }))

    const elkGraph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.spacing.nodeNode': '60',
        'elk.layered.spacing.nodeNodeBetweenLayers': '340',
        'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
        'elk.alignment': 'CENTER',
      },
      children: elkChildren,
      edges: elkEdges,
    }

    elk
      .layout(elkGraph)
      .then((res) => {
        if (isCancelled) return
        const posMap: Record<string, { x: number; y: number }> = {}
        const rootIdClean = cleanId(rootId)
        const rootLayout = res.children?.find((c) => c.id === rootIdClean) || res.children?.[0]
        const rootX = rootLayout?.x ?? 0
        const rootY = rootLayout?.y ?? 0

        const offsetX = ANCHOR_X - rootX
        const offsetY = ANCHOR_Y - rootY

        res.children?.forEach((child) => {
          posMap[child.id] = {
            x: (child.x ?? 0) + offsetX,
            y: (child.y ?? 0) + offsetY,
          }
        })
        setLayoutPositions(posMap)
      })
      .catch((err) => {
        console.warn('ELK layout fallback:', err)
        if (isCancelled) return
        const fallbackMap: Record<string, { x: number; y: number }> = {}
        const groupCounts: Record<number, number> = {}
        visibleNodes.forEach((n) => {
          const g = n.group
          const count = groupCounts[g] || 0
          groupCounts[g] = count + 1
          const x = ANCHOR_X + (g === -1 ? -420 : g * 420)
          const y = 300 + count * 150
          fallbackMap[cleanId(n.id)] = { x, y }
        })
        setLayoutPositions(fallbackMap)
      })

    return () => {
      isCancelled = true
    }
  }, [layoutKey, visibleNodes, filteredLinks, rootId])

  // Build React Flow nodes & edges with dynamic styling
  const { rfNodes, rfEdges } = useMemo(() => {
    if (visibleNodes.length === 0) {
      return { rfNodes: [], rfEdges: [] }
    }

    const computedNodes: Node[] = visibleNodes.map((n, idx) => {
      const nId = cleanId(n.id)
      const childCount = childMap[nId]?.size || 0
      const isExpanded = autoplayCount !== null ? true : expandedNodeIds.has(nId)

      // Cash-Out / Final Destination Detection — only nodes with NO outgoing transactions, group >= 2, never Root
      const incomingForNode = incomingLinksByTarget[nId] || []
      const outgoingForNode = normalizedLinks.filter((l) => cleanId(l.source) === nId)
      const hasIncoming = incomingForNode.length > 0 || filteredLinks.some((l) => cleanId(l.target) === nId)
      const isTerminal = childCount === 0 && outgoingForNode.length === 0 && n.group >= 2 && nId !== rootId && hasIncoming

      let isCashOut = false
      let cashOutType = ''
      let cashOutIcon: 'crypto' | 'atm' | 'forex' | 'cash' | 'terminal' = 'terminal'

      if (isTerminal) {
        // STRICT RULE: Only label as specific cash-out type if narration/memo explicitly contains keywords
        const allNarrations = incomingForNode
          .map((l) => `${l.narration || ''} ${l.transaction_narration || ''} ${l.payment_mode || ''}`)
          .join(' ')
          .toLowerCase()

        if (allNarrations.trim().length > 0) {
          if (/\b(crypto|binance|btc|eth|usdt|wazirx|coindcx|blockchain|token|p2p_crypto)\b/i.test(allNarrations)) {
            isCashOut = true
            cashOutType = 'CRYPTO EXCHANGE'
            cashOutIcon = 'crypto'
          } else if (/\b(atm|withdrawal|dispense|pos_cash)\b/i.test(allNarrations)) {
            isCashOut = true
            cashOutType = 'ATM WITHDRAWAL'
            cashOutIcon = 'atm'
          } else if (/\b(forex|remit|swift|hawala|international|crossborder|foreign)\b/i.test(allNarrations)) {
            isCashOut = true
            cashOutType = 'FOREX / OFFSHORE'
            cashOutIcon = 'forex'
          } else {
            // Standard bank terminal node (not crypto)
            isCashOut = false
            cashOutType = ''
          }
        }
      }

      const inboundTotal = incomingForNode.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0)
      const outboundTotal = outgoingForNode.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0)
      const retainedBalance = Math.round((inboundTotal - outboundTotal) * 100) / 100
      const flowAmount = n.group === -1 ? outboundTotal : inboundTotal > 0 ? inboundTotal : outboundTotal
      const sampleNarration =
        incomingForNode[0]?.transaction_narration ||
        incomingForNode[0]?.narration ||
        outgoingForNode[0]?.transaction_narration ||
        outgoingForNode[0]?.narration ||
        ''

      const pos = layoutPositions[nId] || defaultPositions[nId] || {
        x: ANCHOR_X + (n.group === -1 ? -420 : n.group * 420),
        y: ANCHOR_Y + (idx % 10) * 140,
      }

      const isDimmed = activeHighlight !== null && !activeHighlight.pathNodeIds.has(nId)
      const isFocused = activeHighlight !== null && activeHighlight.pathNodeIds.has(nId)

      return {
        id: nId,
        type: 'accountCard',
        targetPosition: Position.Left,
        sourcePosition: Position.Right,
        position: { x: pos.x, y: pos.y },
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        style: {
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
          opacity: isDimmed ? 0.12 : 1,
          filter: isDimmed ? 'grayscale(100%)' : 'none',
          transition: 'opacity 0.2s ease, filter 0.2s ease',
          pointerEvents: 'auto',
          zIndex: isFocused ? 35 : 1,
        },
        data: {
          id: nId,
          group: n.group,
          bankName: getBankName(nId),
          flowAmount,
          narration: sampleNarration,
          childCount,
          isExpanded,
          isCashOut,
          cashOutType,
          cashOutIcon,
          inboundTotal,
          outboundTotal,
          retainedBalance,
          isFocused,
          onNodeInteraction: handleNodeInteraction,
          onToggleExpand: handleToggleNodeExpand,
        },
      }
    })

    const computedEdges: Edge[] = filteredLinks.map((link, idx) => {
      const s = cleanId(link.source)
      const t = cleanId(link.target)
      const edgeId = `e-${s}->${t}-${idx}`
      const formattedAmt = `₹${Number(link.amount).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`

      // Distinct, elegant colors per hop tier (Hop 4 = Purple)
      const strokeColor =
        link.hop === -1
          ? '#059669'
          : link.hop === 1
          ? '#4f46e5'
          : link.hop === 2
          ? '#d97706'
          : link.hop === 3
          ? '#e11d48'
          : '#9333ea'

      const isEdgeDimmed = activeHighlight !== null && !activeHighlight.pathEdgeIds.has(edgeId)
      const isEdgeFocused = activeHighlight !== null && activeHighlight.pathEdgeIds.has(edgeId)

      return {
        id: edgeId,
        source: s,
        target: t,
        type: 'smoothstep',
        animated: isEdgeFocused ? true : !isEdgeDimmed,
        zIndex: isEdgeFocused ? 25 : 1,
        style: {
          stroke: strokeColor,
          strokeWidth: isEdgeFocused
            ? 4.5
            : Math.min(Math.max((Number(link.amount) || 1000) / 25000, 2), 4),
          opacity: isEdgeDimmed ? 0.08 : 1,
          filter: isEdgeDimmed ? 'grayscale(100%)' : 'none',
          transition: 'opacity 0.2s ease, stroke-width 0.2s ease, filter 0.2s ease',
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: strokeColor,
        },
        data: {
          amount: Number(link.amount),
          formattedAmount: formattedAmt,
          timestamp: link.timestamp,
          hop: link.hop,
          hop_level: link.hop_level,
          index: idx,
          ip_address: link.ip_address,
          device_type: link.device_type,
          payment_mode: link.payment_mode,
          narration: link.transaction_narration || link.narration || '',
          transaction_narration: link.transaction_narration || link.narration || '',
          sourceId: s,
          targetId: t,
          onEdgeClick: handleEdgeInteraction,
        },
      }
    })

    return {
      rfNodes: computedNodes,
      rfEdges: computedEdges,
    }
  }, [
    visibleNodes,
    filteredLinks,
    layoutPositions,
    childMap,
    expandedNodeIds,
    autoplayCount,
    activeHighlight,
    handleNodeInteraction,
    handleToggleNodeExpand,
    handleDraftNotice,
    handleEdgeInteraction,
  ])

  // --- INITIAL VIEWPORT FIT: SMOOTHLY ZOOMS ONTO ROOT VICTIM NODE ONCE ON INITIAL LOAD ---
  useEffect(() => {
    if (rfNodes.length > 0 && !isInitialFitDoneRef.current) {
      isInitialFitDoneRef.current = true
      const timer = setTimeout(() => {
        fitView({ padding: 0.2, duration: 800, maxZoom: 1.2 })
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [rfNodes.length, fitView])

  return (
    <div
      ref={containerRef}
      className={`flex flex-col h-full w-full bg-white text-slate-800 transition-all duration-200 ${
        isFullscreen
          ? 'fixed inset-0 z-50 w-screen h-screen bg-slate-900 p-3'
          : 'relative rounded-xl overflow-hidden border border-slate-200 shadow-sm'
      }`}
    >
      {/* SCOPED CSS FOR ANIMATIONS */}
      <style>{`
        @keyframes nodeScaleIn {
          0% {
            transform: scale(0.7);
            opacity: 0;
          }
          60% {
            transform: scale(1.02);
            opacity: 0.95;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }
        .forensic-node-enter {
          animation: nodeScaleIn 0.28s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          will-change: transform, opacity;
        }

        @keyframes edgeFadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        .react-flow__edge {
          animation: edgeFadeIn 0.2s ease-out forwards;
        }

        @keyframes moneyFlowAnim {
          from {
            stroke-dashoffset: 20;
          }
          to {
            stroke-dashoffset: 0;
          }
        }
        .react-flow__edge-path {
          stroke-dasharray: 6 4 !important;
          animation: moneyFlowAnim 0.85s linear infinite !important;
        }

        @keyframes popupSlideUp {
          0% {
            opacity: 0;
            transform: translateY(10px) scale(0.97);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .forensic-popup-enter {
          animation: popupSlideUp 0.18s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        @keyframes drawerSlideIn {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0%);
          }
        }
        .drawer-slide-in {
          animation: drawerSlideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>

      {/* TOP HEADER CONTROLS TOOLBAR */}
      <div className="shrink-0 p-3 bg-white/95 backdrop-blur-md border-b border-slate-200 flex items-center justify-between flex-wrap gap-2.5 z-10 shadow-xs">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
            <Layers className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-800 tracking-tight flex items-center gap-1.5">
              <span>OSINT Money Trail Flowchart</span>
              <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.2 rounded border border-indigo-200 font-mono">
                Left-to-Right &bull; Anti-Collision Spacing
              </span>
            </h3>
            <span className="text-[10px] text-slate-500 font-mono">
              Root Anchor: <span className="font-bold text-slate-800">{rootId || 'Selected Root'}</span>
            </span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5">
          {/* Expand All Button */}
          <button
            type="button"
            onClick={handleExpandAll}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200 transition active:scale-95 cursor-pointer shadow-2xs"
            title="Expand all 3 layers of connections"
          >
            <FolderPlus className="h-3.5 w-3.5 text-indigo-600" />
            <span>Expand All</span>
          </button>

          {/* Collapse to Root Button */}
          <button
            type="button"
            onClick={handleCollapseToRoot}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs font-semibold border border-slate-200 transition active:scale-95 cursor-pointer shadow-2xs"
            title="Collapse back to Target Hub and Layer 1"
          >
            <FolderMinus className="h-3.5 w-3.5 text-slate-500" />
            <span>Collapse to Root</span>
          </button>

          {/* Center Root Camera Button */}
          <button
            type="button"
            onClick={() => {
              if (rootId) {
                const targetNode = getNode(rootId)
                if (targetNode) {
                  const nodeW = targetNode.measured?.width ?? targetNode.width ?? CARD_WIDTH
                  const nodeH = targetNode.measured?.height ?? targetNode.height ?? CARD_HEIGHT
                  const cx = targetNode.position.x + nodeW / 2
                  const cy = targetNode.position.y + nodeH / 2
                  setCenter(cx, cy, { zoom: 1.2, duration: 700 })
                } else {
                  fitView({
                    nodes: [{ id: rootId }],
                    duration: 700,
                    padding: 0.4,
                    maxZoom: 1.4,
                  })
                }
              } else {
                fitView({ padding: 0.2, duration: 700, maxZoom: 1.2 })
              }
            }}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-medium border border-slate-200 transition cursor-pointer shadow-2xs"
            title="Focus camera on Target Hub suspect node"
          >
            <Focus className="h-3.5 w-3.5 text-indigo-600" />
            <span className="text-[11px] font-semibold">Focus Root</span>
          </button>

          {/* Fit View Button */}
          <button
            type="button"
            onClick={() => fitView({ padding: 0.2, duration: 800, maxZoom: 1.2 })}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200 transition active:scale-95 cursor-pointer shadow-2xs"
            title="Fit Entire Graph into View"
          >
            <Maximize className="h-3.5 w-3.5 text-indigo-600" />
            <span className="text-[11px]">Fit View</span>
          </button>

          {/* Fullscreen Button */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200 transition active:scale-95 cursor-pointer shadow-2xs"
            title={isFullscreen ? 'Exit Fullscreen' : 'View Fullscreen Canvas'}
          >
            {isFullscreen ? (
              <>
                <Minimize2 className="h-3.5 w-3.5 text-slate-600" />
                <span className="text-[11px]">Exit Screen</span>
              </>
            ) : (
              <>
                <Monitor className="h-3.5 w-3.5 text-indigo-600" />
                <span className="text-[11px]">Full Screen</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* CANVAS CONTAINER: SOFT LIGHT GREY (bg-slate-50) WITH CLEAN DOTTED BACKGROUND */}
      <div className="relative flex-1 w-full h-full min-h-[600px] overflow-hidden bg-slate-50">
        {/* HUD TELEMETRY OVERLAY */}
        <div className="absolute top-3 left-3 z-20 pointer-events-none flex flex-col gap-1.5 font-mono text-[11px]">
          {(() => {
            const feederNodesCount = visibleNodes.filter((n) => n.group === -1).length
            const totalSuspectedMules = Math.max(0, visibleNodes.length - 1 - feederNodesCount)
            return (
              <div className="bg-white/95 backdrop-blur-md border border-slate-200 px-3 py-2 rounded-xl shadow-md flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-slate-700">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span className="font-semibold text-emerald-700">{visibleNodes.length}</span>
                  <span className="text-slate-500 text-[10px]">Nodes</span>
                </div>
                <span className="text-slate-300">|</span>
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 font-bold">
                  <ShieldAlert className="h-3.5 w-3.5 text-rose-500" />
                  <span>Total Suspected Mules: {totalSuspectedMules}</span>
                </div>
                <span className="text-slate-300">|</span>
                <div className="flex items-center gap-1.5 text-slate-700">
                  <span className="font-semibold text-indigo-600">{filteredLinks.length}</span>
                  <span className="text-slate-500 text-[10px]">Flows</span>
                </div>
                <span className="text-slate-300">|</span>
                <div className="flex items-center gap-1 text-emerald-700 font-bold">
                  <span>₹{visibleVolume.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>
            )
          })()}

          <div className="bg-white/95 backdrop-blur-md border border-slate-200 px-3 py-1.5 rounded-xl shadow-md flex items-center gap-2 text-[10px] text-slate-600">
            <Clock className="h-3 w-3 text-slate-400" />
            <span className="text-slate-500">Active Horizon:</span>
            <span className="font-bold text-slate-800">{formattedOverlayDate}</span>
          </div>

          {targetRetainedBalance !== null && (
            <div className="bg-white/95 backdrop-blur-md border border-slate-200 px-3 py-1.5 rounded-xl shadow-md flex items-center gap-2 text-[10px]">
              <span className="text-slate-500 font-medium">Target Retained:</span>
              <span
                className={`font-black font-mono px-1.5 py-0.2 rounded border ${
                  targetRetainedBalance >= 0
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-rose-50 text-rose-700 border-rose-200'
                }`}
              >
                {targetRetainedBalance >= 0 ? '+' : '-'}₹{Math.abs(targetRetainedBalance).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}

          {highlightedPathNodeId && (
            <div className="bg-indigo-600/95 backdrop-blur-md text-white border border-indigo-500 px-3 py-1.5 rounded-xl shadow-lg flex items-center justify-between gap-2 pointer-events-auto">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping"></span>
                <span className="text-[10px] text-indigo-200">Active Path:</span>
                <span className="font-bold text-white text-[11px]">{highlightedPathNodeId}</span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setHighlightedPathNodeId(null)
                }}
                className="p-0.5 rounded hover:bg-indigo-500 text-indigo-200 hover:text-white transition cursor-pointer"
                title="Reset Path Highlight (or click background)"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>

        {/* DRAGGABLE POPUP CARD: MOVABLE TELEMETRY DETAILS */}
        {tooltip && popupPos && (
          <div
            style={{
              left: `${popupPos.x}px`,
              top: `${popupPos.y}px`,
            }}
            className="forensic-popup-enter absolute z-30 pointer-events-auto bg-white border border-slate-200 rounded-xl shadow-2xl min-w-[290px] max-w-[340px] text-xs flex flex-col overflow-hidden text-slate-800"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Visual Drag Handle at the top of the popup */}
            <div
              onMouseDown={handleDragHandleMouseDown}
              className="flex items-center justify-between px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 cursor-grab active:cursor-grabbing select-none transition-colors hover:bg-slate-100"
              title="Click and drag to move this card around the canvas"
            >
              <div className="flex items-center gap-2">
                <GripHorizontal className="h-4 w-4 text-slate-400" />
                <span className="text-[11px] font-bold font-mono text-slate-800 tracking-wide uppercase">
                  {tooltip.type === 'node' ? 'Account Profile' : 'Transfer Telemetry'}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 font-semibold">
                  Movable
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setTooltip(null)
                    setPopupPos(null)
                  }}
                  className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition cursor-pointer"
                  title="Close popup"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Content for Node Profile */}
            {tooltip.type === 'node' && (
              <div className="p-3.5 flex flex-col gap-2 font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[10px]">Account ID:</span>
                  <span className="font-extrabold text-slate-900">{tooltip.data.id}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[10px]">Institution:</span>
                  <span className="text-slate-700 font-sans text-[11px] truncate">{tooltip.data.bankName}</span>
                </div>
                <div className="p-2 rounded-lg bg-slate-50 border border-slate-200 flex flex-col gap-1 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Inbound Inflow:</span>
                    <span className="font-bold text-emerald-600">
                      ₹{tooltip.data.totalIn.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({tooltip.data.inboundCount})
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Outbound Dispersal:</span>
                    <span className="font-bold text-rose-600">
                      ₹{tooltip.data.totalOut.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({tooltip.data.outboundCount})
                    </span>
                  </div>
                </div>
                {tooltip.data.sampleNarration && (
                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-[10px] text-slate-600">
                    <div className="text-slate-500 flex items-center gap-1 font-semibold mb-0.5">
                      <FileText className="h-3 w-3 text-slate-400" />
                      <span>Narration / Forensic Memo:</span>
                    </div>
                    <span className="font-mono text-slate-800 break-words">{tooltip.data.sampleNarration}</span>
                  </div>
                )}
                {(tooltip.data.sampleIp || tooltip.data.sampleDevice) && (
                  <div className="text-[10px] text-slate-500 flex flex-col gap-0.5 pt-1 border-t border-slate-100">
                    {tooltip.data.sampleIp && (
                      <div className="flex items-center gap-1">
                        <Globe className="h-3 w-3 text-slate-400" /> IP: {tooltip.data.sampleIp}
                      </div>
                    )}
                    {tooltip.data.sampleDevice && (
                      <div className="flex items-center gap-1">
                        <Smartphone className="h-3 w-3 text-slate-400" /> Device: {tooltip.data.sampleDevice}
                      </div>
                    )}
                  </div>
                )}
                {/* Action button inside tooltip to trigger Section 91 notice */}
                <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setTooltip(null)
                      setPopupPos(null)
                      handleDraftNotice(tooltip.data.id, tooltip.data.bankName)
                    }}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-sans text-[11px] font-bold shadow-sm active:scale-95 transition cursor-pointer"
                  >
                    <Shield className="h-3.5 w-3.5" />
                    <span>Draft Sec 91 Freeze Notice</span>
                  </button>
                </div>
              </div>
            )}

            {/* Content for Edge Telemetry */}
            {tooltip.type === 'edge' && (
              <div className="p-3.5 flex flex-col gap-2 font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[10px]">Amount:</span>
                  <span className="font-extrabold text-sm text-emerald-600">{tooltip.data.formattedAmount}</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-500 text-[10px]">Timestamp:</span>
                  <span className="text-slate-800">{tooltip.data.timestamp}</span>
                </div>
                <div className="p-2 rounded-lg bg-slate-50 border border-slate-200 flex flex-col gap-1 text-[10px]">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">From:</span>
                    <span className="font-bold text-slate-800">{tooltip.data.sourceId}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">To:</span>
                    <span className="font-bold text-slate-800">{tooltip.data.targetId}</span>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-slate-200">
                    <span className="text-slate-500">Mode:</span>
                    <span className="px-1.5 py-0.5 rounded bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold">
                      {tooltip.data.payment_mode || 'STANDARD'}
                    </span>
                  </div>
                </div>
                {(tooltip.data.transaction_narration || tooltip.data.narration) && (
                  <div className="text-[10px] text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-200">
                    <div className="text-slate-500 flex items-center gap-1 mb-0.5 font-semibold">
                      <FileText className="h-3 w-3 text-slate-400" /> Narration / Memo:
                    </div>
                    <span className="font-mono text-slate-800 break-words">{tooltip.data.transaction_narration || tooltip.data.narration}</span>
                  </div>
                )}
                {(tooltip.data.ip_address || tooltip.data.device_type) && (
                  <div className="text-[10px] text-slate-500 flex flex-col gap-0.5">
                    {tooltip.data.ip_address && (
                      <div className="flex items-center gap-1">
                        <Globe className="h-3 w-3 text-slate-400" /> IP: {tooltip.data.ip_address}
                      </div>
                    )}
                    {tooltip.data.device_type && (
                      <div className="flex items-center gap-1">
                        <Smartphone className="h-3 w-3 text-slate-400" /> Device: {tooltip.data.device_type}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* REACT FLOW GRAPH CANVAS: CLEAN DOTTED BACKGROUND ON bg-slate-50 */}
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          panOnDrag={true}
          zoomOnScroll={true}
          selectionOnDrag={false}
          nodesDraggable={true}
          minZoom={0.05}
          maxZoom={2.5}
          onNodeMouseEnter={(_, node) => {
            if (!highlightedPathNodeId) setHoveredNodeId(cleanId(node.id))
          }}
          onNodeMouseLeave={() => {
            if (!highlightedPathNodeId) setHoveredNodeId(null)
          }}
          onNodeClick={(_, node) => handleNodePathClick(cleanId(node.id))}
          onPaneClick={() => {
            setHighlightedPathNodeId(null)
            setTooltip(null)
            setPopupPos(null)
            setHoveredNodeId(null)
            setSelectedNodeDetail(null)
          }}
          proOptions={{ hideAttribution: true }}
          className="bg-slate-50"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="#cbd5e1" className="bg-slate-50" />
          <Controls showInteractive={false} className="!bg-white !border-slate-200 !text-slate-700 !shadow-md [&>button]:!bg-white [&>button]:!border-slate-200 [&>button]:!fill-slate-700 [&>button:hover]:!bg-slate-50" />
          
          {/* DARK GLASS-MORPHISM MINIMAP AT BOTTOM-4 RIGHT-4 */}
          <MiniMap
            position="bottom-right"
            nodeColor={(node: any) => {
              const group = node.data?.group ?? node.group ?? 0
              if (group === -1) return '#10b981' // Source of Funds (Emerald)
              if (group === 0) return '#f43f5e'  // Target Hub Suspect (Rose)
              if (group === 1) return '#6366f1'  // Layer 1 (Indigo)
              if (group === 2) return '#f59e0b'  // Layer 2 (Amber)
              if (group === 3) return '#ef4444'  // Layer 3 (Red)
              return '#94a3b8'
            }}
            nodeStrokeColor="#ffffff"
            nodeStrokeWidth={2}
            nodeBorderRadius={3}
            maskColor="rgba(15, 23, 42, 0.65)"
            maskStrokeColor="#6366f1"
            maskStrokeWidth={2}
            zoomable={true}
            pannable={true}
            className="!h-32 !w-48 !bg-slate-900/90 !backdrop-blur-md !border !border-slate-700/60 !rounded-xl !shadow-2xl overflow-hidden !m-4 !z-50"
            style={{ width: 192, height: 128 }}
          />
        </ReactFlow>

        {/* ========================================================================= */}
        {/* NODE DETAIL SIDE PANEL: DEEP FORENSICS, COUNTERPARTIES & BULK FREEZE */}
        {/* ========================================================================= */}
        {selectedNodeDetail && !isNoticeDrawerOpen && (
          <div
            className="drawer-slide-in absolute top-0 right-0 bottom-0 w-full sm:w-[480px] z-40 bg-white border-l border-slate-200 shadow-2xl flex flex-col overflow-hidden text-slate-800"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Panel Top Header */}
            <div className="p-4 bg-slate-900 text-white border-b border-slate-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
                  <ShieldAlert className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold tracking-tight uppercase font-mono flex items-center gap-1.5">
                    <span>Account Forensic Profile</span>
                    <span className="px-1.5 py-0.2 rounded text-[9px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-sans">
                      OSINT Inspection
                    </span>
                  </h3>
                  <p className="text-[10px] text-slate-400 font-sans mt-0.5">
                    Multi-Layer Telemetry &amp; Laundering Network Inspection
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setSelectedNodeDetail(null)
                  setHighlightedPathNodeId(null)
                }}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
                title="Close inspection panel"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Panel Body Content (Scrollable) */}
            <div className="flex-1 p-4 overflow-y-auto flex flex-col gap-3 bg-slate-50 text-xs">
              {/* Card 1: Target Identity & Layer Tier */}
              <div className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-2xs flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-black text-slate-900">
                      {selectedNodeDetail.id}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(selectedNodeDetail.id)
                      }}
                      className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
                      title="Copy Account ID"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                  <span
                    className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                      selectedNodeDetail.group === -1
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : selectedNodeDetail.group === 0
                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                        : selectedNodeDetail.group === 1
                        ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                        : selectedNodeDetail.group === 2
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-rose-50 text-rose-700 border-rose-200'
                    }`}
                  >
                    {selectedNodeDetail.group === -1
                      ? 'Source of Funds (Feeder)'
                      : selectedNodeDetail.group === 0
                      ? 'Target Hub (Primary Suspect)'
                      : `Layer ${selectedNodeDetail.group} Node`}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 text-slate-600 font-sans text-xs">
                  <Building className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  <span className="font-medium">{selectedNodeDetail.bankName}</span>
                </div>

                {(selectedNodeDetail.ipAddress || selectedNodeDetail.deviceType) && (
                  <div className="flex items-center flex-wrap gap-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500 font-mono">
                    {selectedNodeDetail.ipAddress && (
                      <span className="inline-flex items-center gap-1 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                        <Globe className="h-3 w-3 text-slate-400" />
                        <span>IP: {selectedNodeDetail.ipAddress}</span>
                      </span>
                    )}
                    {selectedNodeDetail.deviceType && (
                      <span className="inline-flex items-center gap-1 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                        <Smartphone className="h-3 w-3 text-slate-400" />
                        <span>{selectedNodeDetail.deviceType}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Card 2: Financial Throughput & Velocity */}
              <div className="grid grid-cols-2 gap-2.5 font-mono">
                <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs flex flex-col gap-1">
                  <span className="text-[10px] text-slate-500 font-medium">Inbound Total</span>
                  <span className="text-sm font-black text-emerald-600">
                    ₹{selectedNodeDetail.inboundTotal.toLocaleString('en-IN', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                  <span className="text-[10px] text-slate-400">{selectedNodeDetail.inboundCount} incoming transfer(s)</span>
                </div>

                <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs flex flex-col gap-1">
                  <span className="text-[10px] text-slate-500 font-medium">Outbound Total</span>
                  <span className="text-sm font-black text-rose-600">
                    ₹{selectedNodeDetail.outboundTotal.toLocaleString('en-IN', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                  <span className="text-[10px] text-slate-400">{selectedNodeDetail.outboundCount} outgoing transfer(s)</span>
                </div>
              </div>

              {/* Retained Balance Badge */}
              <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs flex items-center justify-between font-mono">
                <span className="text-[11px] text-slate-500 font-medium">Retained in Account:</span>
                <span
                  className={`text-xs font-black px-2 py-0.5 rounded border ${
                    selectedNodeDetail.retainedBalance >= 0
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-rose-50 text-rose-700 border-rose-200'
                  }`}
                >
                  {selectedNodeDetail.retainedBalance >= 0 ? '+' : '-'}₹
                  {Math.abs(selectedNodeDetail.retainedBalance).toLocaleString('en-IN', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>

              {/* Card 3: Forensic Narration / Memo */}
              {selectedNodeDetail.narration && (
                <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 text-slate-500 font-semibold text-[11px]">
                    <FileText className="h-3.5 w-3.5 text-slate-400" />
                    <span>Transaction Memo / Narration</span>
                  </div>
                  <p className="font-mono text-xs text-slate-800 break-words bg-slate-50 p-2 rounded-lg border border-slate-200">
                    {selectedNodeDetail.narration}
                  </p>
                </div>
              )}

              {/* Card 4: Immediate Counterparties Breakdown */}
              <div className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-2xs flex flex-col gap-2.5">
                <span className="text-[11px] font-bold text-slate-800 uppercase tracking-wide flex items-center gap-1.5 font-mono">
                  <Users className="h-3.5 w-3.5 text-indigo-600" />
                  <span>Immediate Counterparties</span>
                </span>

                {/* Inbound Transfers */}
                {selectedNodeDetail.inboundLinks.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold text-slate-500 font-mono">
                      Inbound Sources ({selectedNodeDetail.inboundLinks.length})
                    </span>
                    <div className="max-h-28 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-100 bg-slate-50/50">
                      {selectedNodeDetail.inboundLinks.slice(0, 5).map((l, idx) => (
                        <div key={idx} className="p-2 flex items-center justify-between text-[11px] font-mono">
                          <span className="text-slate-700 truncate max-w-[180px]">{cleanId(l.source)}</span>
                          <span className="font-bold text-emerald-600">
                            +₹{Number(l.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Outbound Transfers */}
                {selectedNodeDetail.outboundLinks.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-semibold text-slate-500 font-mono">
                      Outbound Dispersals ({selectedNodeDetail.outboundLinks.length})
                    </span>
                    <div className="max-h-28 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-100 bg-slate-50/50">
                      {selectedNodeDetail.outboundLinks.slice(0, 5).map((l, idx) => (
                        <div key={idx} className="p-2 flex items-center justify-between text-[11px] font-mono">
                          <span className="text-slate-700 truncate max-w-[180px]">{cleanId(l.target)}</span>
                          <span className="font-bold text-rose-600">
                            -₹{Number(l.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Card 5: Downstream Connected Syndicate Network (if descendants exist) */}
              {selectedNodeDetail.downstreamAccounts.length > 0 && (
                <div className="p-3.5 rounded-xl bg-rose-50/70 border border-rose-200 shadow-2xs flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-rose-900 uppercase tracking-wide flex items-center gap-1.5 font-mono">
                      <ShieldAlert className="h-3.5 w-3.5 text-rose-600" />
                      <span>Downstream Syndicate ({selectedNodeDetail.downstreamAccounts.length})</span>
                    </span>
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-rose-200 text-rose-800">
                      Layer 1-3 Mules
                    </span>
                  </div>
                  <p className="text-[11px] text-rose-700 font-sans leading-relaxed">
                    Recursive BFS traversal detected <strong>{selectedNodeDetail.downstreamAccounts.length} reachable downstream beneficiary account(s)</strong> receiving laundered dispersal from this entity.
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {selectedNodeDetail.downstreamAccounts.slice(0, 8).map((acc, aIdx) => (
                      <span
                        key={aIdx}
                        className="px-1.5 py-0.5 rounded bg-white border border-rose-200 text-rose-800 text-[10px] font-mono font-semibold shadow-2xs"
                      >
                        {acc}
                      </span>
                    ))}
                    {selectedNodeDetail.downstreamAccounts.length > 8 && (
                      <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-mono font-bold">
                        +{selectedNodeDetail.downstreamAccounts.length - 8} more
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Panel Bottom Action Buttons */}
            <div className="p-4 bg-white border-t border-slate-200 flex flex-col gap-2 shrink-0 shadow-lg">
              {/* High-Priority Bulk Network Freeze Action (rendered prominently when downstream descendants exist) */}
              {selectedNodeDetail.downstreamAccounts.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const totalVol =
                      selectedNodeDetail.outboundTotal > 0
                        ? selectedNodeDetail.outboundTotal
                        : selectedNodeDetail.inboundTotal > 0
                        ? selectedNodeDetail.inboundTotal
                        : 50000
                    handleDraftNotice(
                      selectedNodeDetail.id,
                      selectedNodeDetail.bankName,
                      selectedNodeDetail.downstreamAccounts,
                      true,
                      totalVol
                    )
                  }}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-red-700 hover:from-rose-500 hover:to-red-600 text-white font-bold text-xs shadow-md shadow-rose-600/30 transition active:scale-95 cursor-pointer"
                  title="Generate Comprehensive Multi-Account Syndicate Sec 91 Freezing Order"
                >
                  <ShieldAlert className="h-4 w-4" />
                  <span>Freeze Downstream Network (Bulk Action &bull; {selectedNodeDetail.downstreamAccounts.length} Accounts)</span>
                </button>
              )}

              {/* Single Node Notice & Ask AI Buttons */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    handleDraftNotice(
                      selectedNodeDetail.id,
                      selectedNodeDetail.bankName,
                      [selectedNodeDetail.id],
                      false,
                      selectedNodeDetail.flowAmount
                    )
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition shadow-xs cursor-pointer active:scale-95"
                >
                  <Shield className="h-3.5 w-3.5" />
                  <span>Draft Sec 91 Notice</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (onAskAI) {
                      onAskAI(selectedNodeDetail.id)
                    }
                  }}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition cursor-pointer active:scale-95 shadow-xs"
                >
                  <Bot className="h-3.5 w-3.5" />
                  <span>Ask AI</span>
                </button>
              </div>

              {/* Export Syndicate Data (CSV) Button */}
              <button
                type="button"
                onClick={handleExportSyndicateCSV}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800 text-xs font-bold transition shadow-2xs cursor-pointer active:scale-95"
                title="Export all transactions in this isolated syndicate trail to CSV"
              >
                <Download className="h-3.5 w-3.5 text-slate-700" />
                <span>Export Syndicate Data (CSV)</span>
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* PHASE 4: RIGHT-SIDE PANEL (DRAWER OVERLAY) FOR SECTION 91 NOTICE & PDF EXPORT */}
        {/* ========================================================================= */}
        {isNoticeDrawerOpen && (
          <>
            {/* Clickable Backdrop overlay to close drawer */}
            <div
              onClick={() => setIsNoticeDrawerOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs z-40 transition-opacity"
              title="Click to dismiss legal drawer"
            />

            {/* Sliding Drawer Panel (from right edge) */}
            <div
              className="drawer-slide-in absolute top-0 right-0 bottom-0 w-full sm:w-[500px] z-50 bg-white border-l border-slate-200 shadow-2xl flex flex-col overflow-hidden text-slate-800"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drawer Top Header */}
              <div className="p-4 bg-slate-900 text-white border-b border-slate-800 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-lg bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
                    <Shield className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold tracking-tight uppercase font-mono flex items-center gap-1.5">
                      <span>Section 91 CrPC Legal Notice</span>
                      <span className="px-1.5 py-0.2 rounded text-[9px] bg-rose-500/20 text-rose-300 border border-rose-500/30 font-sans">
                        Statutory
                      </span>
                    </h3>
                    <p className="text-[10px] text-slate-400 font-sans mt-0.5">
                      AI-Powered Autonomous Freezing Order Directive
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setIsNoticeDrawerOpen(false)}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
                  title="Close side panel"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Target Suspect Telemetry Strip */}
              {activeNoticeTarget && (
                <div className="px-4 py-2.5 bg-rose-50 border-b border-rose-100 flex items-center justify-between text-xs font-mono shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500 uppercase">Target:</span>
                    <span className="font-extrabold text-slate-900">{activeNoticeTarget.accountId}</span>
                    <span className="text-slate-400">&bull;</span>
                    <span className="text-slate-600 font-sans text-[11px] truncate max-w-[130px]" title={activeNoticeTarget.bankName}>
                      {activeNoticeTarget.bankName}
                    </span>
                    {activeNoticeTarget.isBulk && (
                      <span className="px-1.5 py-0.2 rounded text-[9px] bg-rose-200 text-rose-900 font-bold border border-rose-300">
                        SYNDICATE ({activeNoticeTarget.connectedAccounts?.length || 0} MULES)
                      </span>
                    )}
                  </div>
                  <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-extrabold text-[11px] border border-rose-200">
                    ₹{activeNoticeTarget.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              )}

              {/* Drawer Content Area */}
              <div className="flex-1 p-4 overflow-y-auto flex flex-col gap-3 bg-slate-50">
                {/* 1. Loading State */}
                {isLoadingNotice && (
                  <div className="flex-1 min-h-[300px] flex flex-col items-center justify-center p-8 text-center text-slate-500">
                    <div className="relative mb-4">
                      <div className="h-14 w-14 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 shadow-sm animate-pulse">
                        <RefreshCw className="h-7 w-7 animate-spin" />
                      </div>
                    </div>
                    <h4 className="text-sm font-bold text-slate-900 tracking-tight">
                      AI Drafting Sec 91 Notice... Ensuring Local Privacy
                    </h4>
                    <p className="text-xs text-slate-500 max-w-sm mt-1.5 leading-relaxed font-sans">
                      Calling local Ollama inference engine (<code className="text-indigo-600 font-semibold">qwen2.5:1.5b</code>) on <code>127.0.0.1:11434</code>. 
                      Zero cloud exposure &bull; Complete evidentiary privacy & compliance.
                    </p>
                    <div className="mt-4 px-3 py-1 rounded-full bg-white text-slate-600 text-[10px] font-mono border border-slate-200 shadow-xs flex items-center gap-1.5">
                      <Shield className="h-3 w-3 text-emerald-600" />
                      <span>Zero-Telemetry Local Execution</span>
                    </div>
                  </div>
                )}

                {/* 2. Error State */}
                {noticeError && !isLoadingNotice && (
                  <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex flex-col gap-2">
                    <div className="flex items-center gap-2 font-bold text-rose-800">
                      <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
                      <span>Generation Error</span>
                    </div>
                    <p className="leading-relaxed">{noticeError}</p>
                    <button
                      type="button"
                      onClick={() => activeNoticeTarget && handleDraftNotice(activeNoticeTarget.accountId, activeNoticeTarget.bankName)}
                      className="self-start px-3 py-1.5 rounded-lg bg-rose-600 text-white font-bold text-[11px] hover:bg-rose-700 transition cursor-pointer mt-1"
                    >
                      Retry Drafting
                    </button>
                  </div>
                )}

                {/* 3. Generated Legal Document View */}
                {editableNoticeText && !isLoadingNotice && (
                  <div className="flex-1 flex flex-col gap-2">
                    {/* Privacy & Model Validation Pill */}
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-500">
                      <span className="flex items-center gap-1 text-emerald-700 font-semibold">
                        <Check className="h-3 w-3 text-emerald-600" /> Local Ollama (qwen2.5:1.5b) &bull; Privacy Protected
                      </span>
                      <span className="text-slate-400">Editable Legal Draft</span>
                    </div>

                    {/* Scrollable Document Textarea with Professional Serif Font */}
                    <textarea
                      value={editableNoticeText}
                      onChange={(e) => setEditableNoticeText(e.target.value)}
                      className="w-full flex-1 min-h-[380px] p-4 bg-white border border-slate-300 rounded-xl font-serif text-[13px] text-slate-900 leading-relaxed shadow-xs focus:outline-indigo-500 resize-none selection:bg-indigo-100"
                      placeholder="Legal notice document content..."
                      title="Editable Section 91 CrPC Legal Notice"
                    />
                  </div>
                )}
              </div>

              {/* Drawer Bottom Actions: Download PDF (Official) & Copy Actions */}
              {editableNoticeText && !isLoadingNotice && (
                <div className="p-4 bg-white border-t border-slate-200 flex items-center justify-between gap-3 shrink-0 shadow-lg">
                  <button
                    type="button"
                    onClick={handleCopyNotice}
                    className="px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 cursor-pointer shadow-xs"
                    title="Copy notice text"
                  >
                    {copiedNotice ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 text-slate-400" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>

                  {/* PROMINENT PRIMARY ACTION: DOWNLOAD PDF (OFFICIAL) */}
                  <button
                    type="button"
                    onClick={handleDownloadPDF}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-md shadow-rose-600/30 transition active:scale-95 cursor-pointer"
                    title={`Export Sec91_Notice_${cleanId(activeNoticeTarget?.accountId || '')}.pdf`}
                  >
                    <Download className="h-4 w-4" />
                    <span>Download PDF (Official)</span>
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* BOTTOM CONTROLS & TIMELINE SCRUBBER */}
      <div className="shrink-0 p-3 bg-white border-t border-slate-200 flex flex-col gap-2.5 z-10 shadow-xs">
        <div className="flex items-center justify-between flex-wrap gap-2.5 text-xs font-mono">
          {/* Autoplay + Speed Selector + Reset Controls */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleTogglePlay}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white font-bold transition text-xs shadow-sm active:scale-95 cursor-pointer ${
                isPlaying ? 'bg-indigo-700 hover:bg-indigo-800' : 'bg-indigo-600 hover:bg-indigo-700'
              }`}
            >
              {isPlaying ? (
                <>
                  <Pause className="h-3.5 w-3.5" /> Pause
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 fill-current" /> Autoplay
                </>
              )}
            </button>

            {/* Playback Speed Multiplier: 0.5x, 1x, 2x, 5x */}
            <div className="flex items-center gap-1 bg-slate-50 px-2 py-1 rounded-lg border border-slate-200 text-slate-700">
              <Gauge className="h-3.5 w-3.5 text-slate-500" />
              <span className="text-[11px] text-slate-500 font-medium">Speed:</span>
              <select
                value={playbackSpeed}
                onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                className="bg-transparent text-xs font-bold text-indigo-600 font-mono focus:outline-none cursor-pointer"
              >
                <option value={0.5}>0.5x (2000ms)</option>
                <option value={1}>1.0x (1000ms)</option>
                <option value={2}>2.0x (400ms)</option>
                <option value={5}>5.0x (150ms)</option>
              </select>
            </div>

            {/* Reset to Full Trail */}
            <button
              type="button"
              onClick={() => {
                setIsPlaying(false)
                setAutoplayCount(null)
                setSliderTime(timeMetrics.max)
                handleCollapseToRoot()
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-medium transition cursor-pointer shadow-2xs"
              title="Reset timeline and collapse back to root"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset</span>
            </button>
          </div>

          {/* Scrubbed Date & Range info */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500 font-medium">15-Day Execution Window:</span>
            <span className="px-2 py-0.5 rounded bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold font-mono text-xs">
              {formattedOverlayDate}
            </span>
          </div>
        </div>

        {/* Range Slider Track */}
        <div className="flex items-center gap-2.5">
          <span className="text-[10px] font-mono text-slate-500 shrink-0">
            {timeMetrics.hasTimes ? new Date(timeMetrics.min).toLocaleTimeString() : 'Origin'}
          </span>
          <input
            type="range"
            min={timeMetrics.min}
            max={timeMetrics.max}
            step={Math.max(1, Math.floor((timeMetrics.max - timeMetrics.min) / 100))}
            value={activeHorizon}
            onChange={(e) => {
              setIsPlaying(false)
              setAutoplayCount(null)
              setActiveHorizon(Number(e.target.value))
            }}
            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600 hover:accent-indigo-700 focus:outline-none"
          />
          <span className="text-[10px] font-mono text-slate-500 shrink-0">
            {timeMetrics.hasTimes ? new Date(timeMetrics.max).toLocaleTimeString() : 'Latest'}
          </span>
        </div>
      </div>
    </div>
  )
}

// Wrapper with ReactFlowProvider to support useReactFlow hooks
export default function NetworkGraph(props: NetworkGraphProps) {
  return (
    <ReactFlowProvider>
      <NetworkGraphInner {...props} />
    </ReactFlowProvider>
  )
}
