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
  EdgeLabelRenderer,
  getBezierPath,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import type { Node, Edge, NodeProps, EdgeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from '@dagrejs/dagre'
import { jsPDF } from 'jspdf'

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
  Maximize2,
  Minimize2,
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
  Download,
  RefreshCw,
  AlertTriangle,
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
  ip_address?: string
  device_type?: string
  payment_mode?: string
  narration?: string
}

export interface NetworkGraphProps {
  nodes: GraphNode[]
  links: GraphLink[]
  victimId?: string
  totalVolume?: number
  onNodeClick?: (node: GraphNode) => void
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
}

const LAYER_STYLES: Record<number, LayerStyle> = {
  0: {
    border: 'border-emerald-500',
    bg: 'bg-white',
    headerBg: 'bg-emerald-50 border-b border-emerald-100',
    headerText: 'text-emerald-900',
    badgeText: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    dotColor: '#10b981',
    edgeColor: '#10b981',
    label: 'Source of Funds (Hop 0)',
  },
  1: {
    border: 'border-indigo-500',
    bg: 'bg-white',
    headerBg: 'bg-indigo-50 border-b border-indigo-100',
    headerText: 'text-indigo-900',
    badgeText: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    dotColor: '#6366f1',
    edgeColor: '#4f46e5',
    label: 'Layer 1: Primary Mule',
  },
  2: {
    border: 'border-amber-500',
    bg: 'bg-white',
    headerBg: 'bg-amber-50 border-b border-amber-100',
    headerText: 'text-amber-900',
    badgeText: 'bg-amber-100 text-amber-800 border-amber-200',
    dotColor: '#f59e0b',
    edgeColor: '#d97706',
    label: 'Layer 2: Distributor / Smurf',
  },
  3: {
    border: 'border-rose-500',
    bg: 'bg-white',
    headerBg: 'bg-rose-50 border-b border-rose-100',
    headerText: 'text-rose-900',
    badgeText: 'bg-rose-100 text-rose-800 border-rose-200',
    dotColor: '#ef4444',
    edgeColor: '#e11d48',
    label: 'Layer 3: Terminal / Cashout Hub',
  },
}

// --- CUSTOM NODE: CRISP WHITE CARD WITH INTERACTIVE EXPAND/COLLAPSE & SEC 91 ACTION ---
interface AccountNodeData {
  id: string
  group: number
  bankName: string
  childCount?: number
  isExpanded?: boolean
  onNodeInteraction?: (id: string, group: number, event: React.MouseEvent) => void
  onToggleExpand?: (id: string) => void
  onDraftNotice?: (id: string, bankName: string) => void
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
  const isLayer3 = group === 3

  return (
    <div
      onClick={(e) => {
        if (isLayer3 && nodeData?.onDraftNotice) {
          nodeData.onDraftNotice(nodeData.id, nodeData.bankName)
        } else if (nodeData?.onNodeInteraction) {
          nodeData.onNodeInteraction(nodeData.id, group, e)
        }
      }}
      className={`forensic-node-enter relative rounded-xl border-2 transition-all duration-200 select-none cursor-pointer bg-white shadow-md hover:shadow-xl ${
        style.border
      } ${selected ? 'ring-2 ring-indigo-500 ring-offset-2 scale-102 shadow-indigo-500/20' : 'hover:scale-[1.01]'}`}
      style={{ width: 240, height: isLayer3 ? 104 : 92 }}
    >
      {/* Target handle on LEFT edge for incoming money flow */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !bg-indigo-600 !border-2 !border-white !rounded-full -ml-1.5 shadow-xs transition-transform hover:scale-125"
      />

      {/* Top Header Strip with Tier Badge */}
      <div className={`px-2.5 py-1 flex items-center justify-between rounded-t-[10px] ${style.headerBg}`}>
        <div className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full shrink-0 animate-pulse"
            style={{ backgroundColor: style.dotColor }}
          />
          <span className={`text-[10px] font-mono font-bold tracking-tight uppercase ${style.headerText}`}>
            {group === 0 ? 'Victim' : isLayer3 ? 'Layer 3 Terminal' : `Layer ${group}`}
          </span>
        </div>
        <span className={`text-[9px] font-mono font-semibold px-1.5 py-0.2 rounded border ${style.badgeText}`}>
          {group === 0 ? 'SOURCE' : `HOP ${group}`}
        </span>
      </div>

      {/* Card Body: Crisp White Card Content */}
      <div className={`p-2.5 flex flex-col justify-between ${isLayer3 ? 'h-[72px]' : 'h-[60px]'} bg-white rounded-b-[10px]`}>
        {/* Account ID + Copy Action */}
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs font-black tracking-tight text-slate-900 truncate max-w-[170px]" title={nodeData.id}>
            {nodeData.id}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
            title="Copy Account ID"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
          </button>
        </div>

        {/* Bank Institution Name */}
        <div className="flex items-center gap-1 text-[11px] text-slate-600 truncate font-sans">
          <Building className="h-3 w-3 text-slate-400 shrink-0" />
          <span className="truncate" title={nodeData.bankName}>
            {nodeData.bankName}
          </span>
        </div>

        {/* Dedicated Section 91 Notice Button for Layer 3 Terminal Nodes */}
        {isLayer3 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              if (nodeData?.onDraftNotice) {
                nodeData.onDraftNotice(nodeData.id, nodeData.bankName)
              }
            }}
            className="mt-1 flex items-center justify-center gap-1 w-full py-0.5 px-2 rounded-md bg-rose-600 hover:bg-rose-700 text-white font-sans text-[9px] font-bold shadow-xs active:scale-95 transition cursor-pointer"
            title="Draft Autonomous Section 91 CrPC Freezing Order"
          >
            <Shield className="h-2.5 w-2.5" />
            <span>Draft Sec 91 Notice</span>
          </button>
        )}
      </div>

      {/* Source handle on RIGHT edge for outgoing money flow */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !bg-indigo-600 !border-2 !border-white !rounded-full -mr-1.5 shadow-xs transition-transform hover:scale-125"
      />

      {/* Interactive Expand / Collapse Toggle Pill on Right Edge */}
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
  data,
  selected,
}: EdgeProps) {
  const edgeData = data as unknown as MoneyFlowEdgeData | undefined

  // Sweeping organic Bezier curve directly connecting parent right handle to child left handle
  const deltaY = Math.abs(targetY - sourceY)
  const curvature = deltaY > 300 ? 0.38 : deltaY > 150 ? 0.32 : 0.28

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition: Position.Right,
    targetX,
    targetY,
    targetPosition: Position.Left,
    curvature,
  })

  const formattedAmt = edgeData?.formattedAmount || '$0.00'
  const timestamp = edgeData?.timestamp || ''

  const hopColor =
    edgeData?.hop === 1
      ? 'border-indigo-200 text-indigo-700 bg-indigo-50'
      : edgeData?.hop === 2
      ? 'border-amber-200 text-amber-700 bg-amber-50'
      : 'border-rose-200 text-rose-700 bg-rose-50'

  return (
    <>
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
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className={`nodrag nopan group cursor-pointer flex flex-col items-center justify-center bg-white border ${
            selected ? 'border-indigo-500 ring-2 ring-indigo-500/30' : 'border-slate-200 hover:border-indigo-400'
          } shadow-md rounded-lg px-2.5 py-1 select-none transition-all duration-150 z-20 hover:shadow-lg`}
          onClick={(e) => {
            e.stopPropagation()
            if (edgeData?.onEdgeClick) {
              edgeData.onEdgeClick(edgeData, e)
            }
          }}
        >
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-mono font-extrabold text-slate-900 tracking-tight whitespace-nowrap">
              {formattedAmt}
            </span>
            <span className={`text-[8px] font-mono font-bold px-1 py-0.2 rounded border ${hopColor}`}>
              H{edgeData?.hop || 1}
            </span>
          </div>
          {timestamp && (
            <div className="text-[9px] font-mono text-slate-500 tracking-tighter whitespace-nowrap">
              {timestamp.includes(' ') ? timestamp.split(' ')[1] : timestamp}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
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
}

function NetworkGraphInner({
  nodes,
  links,
  victimId: _victimId,
  totalVolume: _totalVolume,
  onNodeClick: _onNodeClick,
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

  // React Flow instance hooks
  const { fitView, setCenter } = useReactFlow()
  const isInitialFitDoneRef = useRef(false)

  // Normalize incoming nodes with clean IDs
  const normalizedNodes = useMemo(() => {
    return nodes.map((n) => ({
      ...n,
      id: cleanId(n.id),
      group: typeof n.group === 'number' ? n.group : 0,
    }))
  }, [nodes])

  // Normalize incoming links with clean IDs
  const normalizedLinks = useMemo(() => {
    return links
      .map((l) => ({
        ...l,
        source: cleanId(l.source),
        target: cleanId(l.target),
        amount: Number(l.amount) || 0,
        hop: Number(l.hop) || 1,
      }))
      .filter((l) => l.source !== '' && l.target !== '')
  }, [links])

  const cleanVictimId = cleanId(_victimId)

  // Locate the authoritative Root Victim node
  const rootNode = useMemo(() => {
    return (
      normalizedNodes.find((n) => n.group === 0) ||
      normalizedNodes.find((n) => n.id === cleanVictimId) ||
      normalizedNodes[0]
    )
  }, [normalizedNodes, cleanVictimId])

  const rootId = rootNode ? cleanId(rootNode.id) : cleanVictimId

  // --- INTERACTIVE COLLAPSIBLE TREE STATE ---
  // Initial state: Only Victim (Hop 0) and Layer 1 nodes are expanded. Layer 2 and 3 nodes are collapsed by default!
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    if (rootId) initial.add(rootId)
    return initial
  })

  // Reset expanded state whenever new victim dataset is loaded
  useEffect(() => {
    const initial = new Set<string>()
    if (rootId) initial.add(rootId)
    setExpandedNodeIds(initial)
    isInitialFitDoneRef.current = false
  }, [rootId])

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
    setExpandedNodeIds((prev) => {
      const next = new Set(prev)
      if (next.has(clean)) {
        next.delete(clean)
      } else {
        next.add(clean)
      }
      return next
    })
  }, [])

  // Global Expand All: reveal all Hop 1, 2, and 3 nodes
  const handleExpandAll = useCallback(() => {
    setAutoplayCount(null)
    const allParentIds = new Set<string>()
    normalizedLinks.forEach((l) => allParentIds.add(cleanId(l.source)))
    normalizedNodes.forEach((n) => allParentIds.add(cleanId(n.id)))
    setExpandedNodeIds(allParentIds)
  }, [normalizedLinks, normalizedNodes])

  // Global Collapse to Root: hide everything except Hop 0 and Hop 1
  const handleCollapseToRoot = useCallback(() => {
    setAutoplayCount(null)
    const rootSet = new Set<string>()
    if (rootId) rootSet.add(rootId)
    setExpandedNodeIds(rootSet)
  }, [rootId])

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

  // Time-travel scrubber state
  const [sliderTime, setSliderTime] = useState<number>(timeMetrics.max)

  // Reset slider whenever new dataset is loaded
  useEffect(() => {
    setSliderTime(timeMetrics.max)
    setIsPlaying(false)
    setAutoplayCount(null)
    setTooltip(null)
    setPopupPos(null)
  }, [timeMetrics.min, timeMetrics.max])

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

  // Keep sliderTime synchronized with autoplay progress
  useEffect(() => {
    if (autoplayCount !== null && autoplayCount > 0 && autoplayCount <= sortedLinks.length) {
      const activeLink = sortedLinks[autoplayCount - 1]
      if (activeLink) {
        const t = parseTimestamp(activeLink.timestamp)
        if (t !== null) {
          setSliderTime(t)
        }
      }
    }
  }, [autoplayCount, sortedLinks])

  // --- STRICT SYNCHRONIZED GRAPH FILTER ENGINE (ZERO ORPHANS GUARANTEE) ---
  const { filteredLinks, visibleNodes } = useMemo(() => {
    const visibleNodeIds = new Set<string>()
    if (rootId) visibleNodeIds.add(rootId)

    const finalLinksMap = new Map<string, GraphLink>()

    if (autoplayCount !== null && autoplayCount > 0) {
      // Mode A: Autoplay step-by-step chronological animation
      const activeLinks = sortedLinks.slice(0, autoplayCount)
      activeLinks.forEach((l) => {
        const s = cleanId(l.source)
        const t = cleanId(l.target)
        visibleNodeIds.add(s)
        visibleNodeIds.add(t)
        finalLinksMap.set(`${s}->${t}`, l)
      })
    } else {
      // Mode B: Interactive Tree & Timeline Scrubber
      // Step B1: Traverse expanded hierarchy outward from root
      const hierQueue = Array.from(visibleNodeIds)
      const hierVisited = new Set<string>()

      while (hierQueue.length > 0) {
        const currId = hierQueue.shift()!
        if (hierVisited.has(currId)) continue
        hierVisited.add(currId)

        if (expandedNodeIds.has(currId)) {
          const directChildren = childMap[currId]
          if (directChildren) {
            directChildren.forEach((childId) => {
              visibleNodeIds.add(childId)
              hierQueue.push(childId)
            })
          }
        }
      }

      // Step B2: Collect candidate links between visible nodes where parent is expanded
      const candidateLinks = normalizedLinks.filter((l) => {
        const s = cleanId(l.source)
        const t = cleanId(l.target)
        return visibleNodeIds.has(s) && visibleNodeIds.has(t) && expandedNodeIds.has(s)
      })

      // Step B3: Apply timeline filter to candidate links
      if (!timeMetrics.hasTimes || sliderTime >= timeMetrics.max) {
        candidateLinks.forEach((l) => {
          finalLinksMap.set(`${cleanId(l.source)}->${cleanId(l.target)}`, l)
        })
      } else {
        candidateLinks.forEach((l) => {
          const t = parseTimestamp(l.timestamp)
          if (t === null || t <= sliderTime) {
            finalLinksMap.set(`${cleanId(l.source)}->${cleanId(l.target)}`, l)
          }
        })
      }
    }

    // STRICT RULES 1 & 2 ENFORCEMENT:
    // For every visible node (other than root), its incoming parent edge MUST be forced visible,
    // and its parent node MUST be added to visibleNodeIds, regardless of timestamp discrepancies!
    let changed = true
    while (changed) {
      changed = false
      const currentNodes = Array.from(visibleNodeIds)

      for (const targetId of currentNodes) {
        if (targetId === rootId) continue

        let hasIncoming = false
        for (const l of finalLinksMap.values()) {
          if (cleanId(l.target) === targetId) {
            hasIncoming = true
            break
          }
        }

        if (!hasIncoming) {
          const incomingCandidates = incomingLinksByTarget[targetId] || []
          if (incomingCandidates.length > 0) {
            const chosenLink =
              incomingCandidates.find((l) => expandedNodeIds.has(cleanId(l.source))) ||
              incomingCandidates[0]

            if (chosenLink) {
              const s = cleanId(chosenLink.source)
              const t = cleanId(chosenLink.target)
              const key = `${s}->${t}`
              if (!finalLinksMap.has(key)) {
                finalLinksMap.set(key, chosenLink)
                if (!visibleNodeIds.has(s)) {
                  visibleNodeIds.add(s)
                  changed = true
                }
              }
            }
          }
        }
      }
    }

    const finalLinks = Array.from(finalLinksMap.values())
    const finalNodes = normalizedNodes.filter((n) => visibleNodeIds.has(cleanId(n.id)))

    return { filteredLinks: finalLinks, visibleNodes: finalNodes }
  }, [
    autoplayCount,
    sortedLinks,
    rootId,
    expandedNodeIds,
    childMap,
    incomingLinksByTarget,
    normalizedLinks,
    normalizedNodes,
    timeMetrics.hasTimes,
    timeMetrics.max,
    sliderTime,
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

  // --- PHASE 4: TRIGGER SECTION 91 NOTICE GENERATION & OPEN DRAWER ---
  const handleDraftNotice = useCallback(
    async (accountId: string, bankName: string) => {
      const cleanTarget = cleanId(accountId)
      if (!cleanTarget) return

      const inbound = normalizedLinks.filter((l) => cleanId(l.target) === cleanTarget)
      const totalIn = inbound.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0)
      const outbound = normalizedLinks.filter((l) => cleanId(l.source) === cleanTarget)
      const totalOut = outbound.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0)
      const targetAmt = totalIn > 0 ? totalIn : totalOut > 0 ? totalOut : 50000

      const targetBank = bankName || getBankName(cleanTarget)

      setActiveNoticeTarget({
        accountId: cleanTarget,
        bankName: targetBank,
        amount: targetAmt,
      })

      setIsNoticeDrawerOpen(true)
      setIsLoadingNotice(true)
      setNoticeError(null)
      setEditableNoticeText('')
      setCopiedNotice(false)

      try {
        const res = await fetch('/api/generate-notice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            account_id: cleanTarget,
            bank_name: targetBank,
            amount: targetAmt,
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

  // PHASE 4: PDF EXPORT INTEGRATION USING jsPDF
  const handleDownloadPDF = () => {
    if (!editableNoticeText || !activeNoticeTarget) return

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    })

    doc.setFont('times', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(190, 18, 60)
    doc.text('CONFIDENTIAL - CYBER FORENSICS CELL', 105, 14, { align: 'center' })

    doc.setFontSize(8)
    doc.setTextColor(100, 116, 139)
    doc.text('FINANCIAL FRAUD INVESTIGATION & ASSET FREEZING DIVISION', 105, 19, { align: 'center' })

    doc.setDrawColor(203, 213, 225)
    doc.setLineWidth(0.4)
    doc.line(15, 22, 195, 22)

    doc.setFont('times', 'normal')
    doc.setFontSize(10.5)
    doc.setTextColor(15, 23, 42)

    const splitText = doc.splitTextToSize(editableNoticeText, 175)
    let cursorY = 30
    const lineHeight = 5.2
    const pageHeight = 275

    for (let i = 0; i < splitText.length; i++) {
      if (cursorY > pageHeight) {
        doc.addPage()
        cursorY = 20
      }
      doc.text(splitText[i], 18, cursorY)
      cursorY += lineHeight
    }

    const fileName = `Sec91_Notice_${cleanId(activeNoticeTarget.accountId)}.pdf`
    doc.save(fileName)
  }

  // Copy notice text to clipboard
  const handleCopyNotice = () => {
    if (!editableNoticeText) return
    navigator.clipboard.writeText(editableNoticeText)
    setCopiedNotice(true)
    setTimeout(() => setCopiedNotice(false), 2000)
  }

  // Node Click interaction handler
  const handleNodeInteraction = useCallback(
    (nodeId: string, group: number, e: React.MouseEvent) => {
      const cleanTarget = cleanId(nodeId)
      const containerRect = containerRef.current?.getBoundingClientRect()
      if (!containerRect) return

      let x = e.clientX - containerRect.left + 15
      let y = e.clientY - containerRect.top + 15

      const cardWidth = 320
      const cardHeight = 310

      if (x + cardWidth > containerRect.width) {
        x = Math.max(10, e.clientX - containerRect.left - cardWidth - 15)
      }
      if (y + cardHeight > containerRect.height) {
        y = Math.max(10, e.clientY - containerRect.top - cardHeight - 15)
      }

      const inbound = normalizedLinks.filter((l) => cleanId(l.target) === cleanTarget)
      const outbound = normalizedLinks.filter((l) => cleanId(l.source) === cleanTarget)
      const totalIn = inbound.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0)
      const totalOut = outbound.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0)

      setTooltip({
        type: 'node',
        data: {
          id: cleanTarget,
          group,
          bankName: getBankName(cleanTarget),
          inboundCount: inbound.length,
          outboundCount: outbound.length,
          totalIn,
          totalOut,
          sampleIp: inbound[0]?.ip_address || outbound[0]?.ip_address,
          sampleDevice: inbound[0]?.device_type || outbound[0]?.device_type,
        },
      })
      setPopupPos({ x, y })
    },
    [normalizedLinks]
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

  // --- CRITICAL DAGRE LAYOUT ENGINE (DRYNAMIC SYMMETRICAL EXPANSION & ZERO OVERLAPS) ---
  // Parameter settings strictly per prompt:
  // ranksep: 420 (horizontal gap between ranks)
  // nodesep: 150 (strict vertical blank gap between sibling card boundaries)
  // align: 'c' (centers children evenly relative to their parent)
  const CARD_WIDTH = 240
  const CARD_HEIGHT_DEFAULT = 92
  const CARD_HEIGHT_L3 = 104

  const { rfNodes, rfEdges, rootCenterX, rootCenterY } = useMemo(() => {
    if (visibleNodes.length === 0) {
      return { rfNodes: [], rfEdges: [], rootCenterX: 240, rootCenterY: 450 }
    }

    const g = new dagre.graphlib.Graph()
    g.setDefaultEdgeLabel(() => ({}))
    g.setGraph({
      rankdir: 'LR',
      nodesep: 150, // Massive vertical spacing between siblings: guarantees zero overlap!
      ranksep: 420, // Wide horizontal spacing between hops for elegant bezier sweeps
      align: 'c',   // Center alignment expands tree symmetrically
      marginx: 50,
      marginy: 50,
    })

    const visibleNodeIdSet = new Set(visibleNodes.map((n) => cleanId(n.id)))

    // Register all visible nodes in Dagre graph with explicit widths and heights
    visibleNodes.forEach((node) => {
      const nId = cleanId(node.id)
      const isL3 = node.group === 3
      g.setNode(nId, {
        width: CARD_WIDTH,
        height: isL3 ? CARD_HEIGHT_L3 : CARD_HEIGHT_DEFAULT,
      })
    })

    // Register all active edges in Dagre graph
    filteredLinks.forEach((link) => {
      const s = cleanId(link.source)
      const t = cleanId(link.target)
      if (s && t && visibleNodeIdSet.has(s) && visibleNodeIdSet.has(t)) {
        g.setEdge(s, t)
      }
    })

    // Synchronously compute graph layout
    dagre.layout(g)

    // Invariant root anchoring: anchor root node at (120, 400)
    const rootIdClean = cleanId(rootId)
    const rootLayout = g.node(rootIdClean) || g.node(cleanId(visibleNodes[0].id))
    const rootRawX = rootLayout ? rootLayout.x - CARD_WIDTH / 2 : 120
    const rootRawY = rootLayout ? rootLayout.y - CARD_HEIGHT_DEFAULT / 2 : 400

    const ANCHOR_X = 120
    const ANCHOR_Y = 400

    const offsetX = ANCHOR_X - rootRawX
    const offsetY = ANCHOR_Y - rootRawY

    const computedRootCenterX = ANCHOR_X + CARD_WIDTH / 2
    const computedRootCenterY = ANCHOR_Y + CARD_HEIGHT_DEFAULT / 2

    // Build React Flow nodes
    const computedNodes: Node[] = visibleNodes.map((n) => {
      const nId = cleanId(n.id)
      const isL3 = n.group === 3
      const nodeH = isL3 ? CARD_HEIGHT_L3 : CARD_HEIGHT_DEFAULT
      const layoutInfo = g.node(nId)

      const finalX = layoutInfo ? layoutInfo.x - CARD_WIDTH / 2 + offsetX : ANCHOR_X + n.group * 420
      const finalY = layoutInfo ? layoutInfo.y - nodeH / 2 + offsetY : ANCHOR_Y

      const childCount = childMap[nId]?.size || 0
      const isExpanded = autoplayCount !== null ? true : expandedNodeIds.has(nId)

      return {
        id: nId,
        type: 'accountCard',
        targetPosition: Position.Left,
        sourcePosition: Position.Right,
        position: { x: finalX, y: finalY },
        width: CARD_WIDTH,
        height: nodeH,
        style: { width: CARD_WIDTH, height: nodeH },
        data: {
          id: nId,
          group: n.group,
          bankName: getBankName(nId),
          childCount,
          isExpanded,
          onNodeInteraction: handleNodeInteraction,
          onToggleExpand: handleToggleNodeExpand,
          onDraftNotice: handleDraftNotice,
        },
      }
    })

    // Build React Flow edges with distinct colors & Bezier curve routing
    const computedEdges: Edge[] = filteredLinks.map((link, idx) => {
      const s = cleanId(link.source)
      const t = cleanId(link.target)
      const formattedAmt = `$${Number(link.amount).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`

      // Distinct, elegant colors per hop tier
      const strokeColor =
        link.hop === 1 ? '#4f46e5' : link.hop === 2 ? '#d97706' : '#e11d48'

      return {
        id: `e-${s}->${t}-${idx}`,
        source: s,
        target: t,
        type: 'bezier',
        animated: true,
        style: {
          stroke: strokeColor,
          strokeWidth: Math.min(Math.max((Number(link.amount) || 1000) / 25000, 2), 4.5),
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
          index: idx,
          ip_address: link.ip_address,
          device_type: link.device_type,
          payment_mode: link.payment_mode,
          narration: link.narration,
          sourceId: s,
          targetId: t,
          onEdgeClick: handleEdgeInteraction,
        },
      }
    })

    return {
      rfNodes: computedNodes,
      rfEdges: computedEdges,
      rootCenterX: computedRootCenterX,
      rootCenterY: computedRootCenterY,
    }
  }, [
    visibleNodes,
    filteredLinks,
    rootId,
    childMap,
    expandedNodeIds,
    autoplayCount,
    handleNodeInteraction,
    handleToggleNodeExpand,
    handleDraftNotice,
  ])

  // --- INITIAL VIEWPORT FIT: SMOOTHLY ZOOMS ONTO ROOT VICTIM NODE ONCE ON INITIAL LOAD ---
  useEffect(() => {
    if (rfNodes.length > 0 && !isInitialFitDoneRef.current) {
      isInitialFitDoneRef.current = true
      const timer = setTimeout(() => {
        setCenter(rootCenterX, rootCenterY, { zoom: 1.15, duration: 800 })
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [rfNodes.length, rootCenterX, rootCenterY, setCenter])

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
            title="Collapse back to Victim and Layer 1"
          >
            <FolderMinus className="h-3.5 w-3.5 text-slate-500" />
            <span>Collapse to Root</span>
          </button>

          {/* Center Root Camera Button */}
          <button
            type="button"
            onClick={() => setCenter(rootCenterX, rootCenterY, { zoom: 1.15, duration: 600 })}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-medium border border-slate-200 transition cursor-pointer shadow-2xs"
            title="Focus camera on Root Victim node"
          >
            <Focus className="h-3.5 w-3.5 text-indigo-600" />
            <span className="text-[11px] font-semibold">Focus Root</span>
          </button>

          {/* Fit View Button */}
          <button
            type="button"
            onClick={() => fitView({ padding: 0.2, duration: 600 })}
            className="p-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs border border-slate-200 transition cursor-pointer shadow-2xs"
            title="Fit Entire Graph into View"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>

          {/* Fullscreen Button */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="p-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 transition cursor-pointer shadow-2xs"
            title={isFullscreen ? 'Exit Fullscreen' : 'View Fullscreen Canvas'}
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* CANVAS CONTAINER: SOFT LIGHT GREY (bg-slate-50) WITH CLEAN DOTTED BACKGROUND */}
      <div className="relative flex-1 w-full h-full min-h-[460px] overflow-hidden bg-slate-50">
        {/* HUD TELEMETRY OVERLAY */}
        <div className="absolute top-3 left-3 z-20 pointer-events-none flex flex-col gap-1.5 font-mono text-[11px]">
          <div className="bg-white/95 backdrop-blur-md border border-slate-200 px-3 py-2 rounded-xl shadow-md flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-slate-700">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="font-semibold text-emerald-700">{visibleNodes.length}</span>
              <span className="text-slate-500 text-[10px]">Nodes</span>
            </div>
            <span className="text-slate-300">|</span>
            <div className="flex items-center gap-1.5 text-slate-700">
              <span className="font-semibold text-indigo-600">{filteredLinks.length}</span>
              <span className="text-slate-500 text-[10px]">Flows</span>
            </div>
            <span className="text-slate-300">|</span>
            <div className="flex items-center gap-1 text-emerald-700 font-bold">
              <span>${visibleVolume.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </div>

          <div className="bg-white/95 backdrop-blur-md border border-slate-200 px-3 py-1.5 rounded-xl shadow-md flex items-center gap-2 text-[10px] text-slate-600">
            <Clock className="h-3 w-3 text-slate-400" />
            <span className="text-slate-500">Active Horizon:</span>
            <span className="font-bold text-slate-800">{formattedOverlayDate}</span>
          </div>
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
                      ${tooltip.data.totalIn.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({tooltip.data.inboundCount})
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Outbound Dispersal:</span>
                    <span className="font-bold text-rose-600">
                      ${tooltip.data.totalOut.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({tooltip.data.outboundCount})
                    </span>
                  </div>
                </div>
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
                {tooltip.data.narration && (
                  <div className="text-[10px] text-slate-600 bg-slate-50 p-1.5 rounded border border-slate-200">
                    <div className="text-slate-500 flex items-center gap-1 mb-0.5">
                      <FileText className="h-2.5 w-2.5" /> Memo:
                    </div>
                    {tooltip.data.narration}
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
          panOnScroll={true}
          zoomOnScroll={true}
          zoomOnPinch={true}
          selectionOnDrag={false}
          nodesDraggable={true}
          minZoom={0.05}
          maxZoom={2.5}
          onPaneClick={() => {
            setTooltip(null)
            setPopupPos(null)
          }}
          proOptions={{ hideAttribution: true }}
          className="bg-slate-50"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="#cbd5e1" className="bg-slate-50" />
          <Controls showInteractive={false} className="!bg-white !border-slate-200 !text-slate-700 !shadow-md [&>button]:!bg-white [&>button]:!border-slate-200 [&>button]:!fill-slate-700 [&>button:hover]:!bg-slate-50" />
          
          {/* DYNAMIC MINIMAP WITH EXPLICIT SIZING & COLOR CODING */}
          <MiniMap
            nodeColor={(node: any) => {
              const group = node.data?.group ?? node.group ?? 0
              if (group === 0) return '#10b981' // Victim (Emerald)
              if (group === 1) return '#4f46e5' // Layer 1 (Indigo)
              if (group === 2) return '#f59e0b' // Layer 2 (Amber)
              if (group === 3) return '#ef4444' // Layer 3 (Red)
              return '#94a3b8'
            }}
            nodeStrokeColor="#ffffff"
            nodeStrokeWidth={2}
            nodeBorderRadius={3}
            maskColor="rgba(241, 245, 249, 0.75)"
            maskStrokeColor="#6366f1"
            maskStrokeWidth={2}
            zoomable={true}
            pannable={true}
            className="!h-32 !w-48 !bg-white !border !border-slate-200 !rounded-xl !shadow-lg overflow-hidden"
            style={{ width: 192, height: 128 }}
          />
        </ReactFlow>

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
                  </div>
                  <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-extrabold text-[11px] border border-rose-200">
                    ${activeNoticeTarget.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
            <span className="text-[11px] text-slate-500 font-medium">Scrubber Position:</span>
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
            value={sliderTime}
            onChange={(e) => {
              setIsPlaying(false)
              setAutoplayCount(null)
              setSliderTime(Number(e.target.value))
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
