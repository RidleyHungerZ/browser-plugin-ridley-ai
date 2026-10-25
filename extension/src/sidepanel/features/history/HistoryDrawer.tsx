import { useEffect, useMemo, useState } from 'react'
import { modelKey, type SessionMeta } from '@/shared/types'
import {
  deleteSession,
  openSession,
  refreshSessions,
  renameSession,
  startNewSession,
  togglePin,
} from '../../state/chat'
import { useAppStore } from '../../state/store'
import { FilterableSelect } from '../../ui/FilterableSelect'
import { Icon } from '../../ui/Icon'
import { Modal } from '../../ui/Modal'
import { toast } from '../../ui/Toast'
import { formatDateTime, formatDomain, formatRelative } from '../../utils/format'
import styles from './HistoryDrawer.module.css'

type Range = 'all' | 'today' | '7d' | '30d'

const RANGE_OPTIONS = [
  { value: 'all', label: '全部时间' },
  { value: 'today', label: '今天' },
  { value: '7d', label: '最近 7 天' },
  { value: '30d', label: '最近 30 天' },
]

const SORT_OPTIONS = [
  { value: 'updatedAt', label: '最后活跃时间' },
  { value: 'createdAt', label: '创建时间' },
]

function startOfToday(): number {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function HistoryDrawer() {
  const open = useAppStore((state) => state.historyOpen)
  const sessions = useAppStore((state) => state.sessions)
  const settings = useAppStore((state) => state.settings)
  const activeSessionId = useAppStore((state) => state.activeSessionId)
  const streaming = useAppStore((state) => state.streaming)
  const status = useAppStore((state) => state.status)
  const patch = useAppStore((state) => state.patch)

  const [search, setSearch] = useState('')
  const [modelFilter, setModelFilter] = useState('')
  const [range, setRange] = useState<Range>('all')
  const [pinnedOnly, setPinnedOnly] = useState(false)
  const [sort, setSort] = useState('updatedAt')
  const [order, setOrder] = useState<'desc' | 'asc'>('desc')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)

  useEffect(() => {
    if (open) void refreshSessions()
  }, [open])

  const modelOptions = useMemo(() => {
    const options: Array<{
      value: string
      label: string
      hint?: string
      group?: string
      groupLabel?: string
    }> = [{ value: '', label: '全部模型' }]
    for (const provider of settings?.providers ?? []) {
      for (const model of provider.models) {
        options.push({
          value: modelKey(provider.id, model.id),
          label: model.label || model.id,
          hint: provider.name,
          group: provider.id,
          groupLabel: provider.name,
        })
      }
    }
    return options
  }, [settings])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    const since =
      range === 'today'
        ? startOfToday()
        : range === '7d'
          ? Date.now() - 7 * 86_400_000
          : range === '30d'
            ? Date.now() - 30 * 86_400_000
            : 0

    const list = sessions.filter((session) => {
      if (pinnedOnly && !session.pinned) return false
      if (modelFilter && `${session.providerId}::${session.modelId}` !== modelFilter) return false
      if (since && session.updatedAt < since) return false
      if (query && !`${session.title} ${session.preview}`.toLowerCase().includes(query)) return false
      return true
    })

    list.sort((a, b) => {
      const av = sort === 'createdAt' ? a.createdAt : a.updatedAt
      const bv = sort === 'createdAt' ? b.createdAt : b.updatedAt
      return order === 'asc' ? av - bv : bv - av
    })
    return list
  }, [sessions, search, modelFilter, range, pinnedOnly, sort, order])

  const modelLabels = useMemo(() => {
    const map = new Map<string, string>()
    for (const provider of settings?.providers ?? []) {
      for (const model of provider.models) {
        map.set(`${provider.id}::${model.id}`, `${provider.name} · ${model.label || model.id}`)
      }
    }
    return map
  }, [settings])

  const commitRename = async (id: string) => {
    const title = editTitle.trim()
    setEditingId(null)
    if (!title) return
    try {
      await renameSession(id, title)
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const onSelect = (session: SessionMeta) => {
    patch({ historyOpen: false })
    void openSession(session.id)
  }

  return (
    <Modal
      open={open}
      onClose={() => patch({ historyOpen: false })}
      title="历史会话"
      subtitle={`${filtered.length} / ${sessions.length} 个会话`}
      width={680}
      fullScreen
    >
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.newSession}
          onClick={() => {
            patch({ historyOpen: false })
            startNewSession({ force: true })
          }}
        >
          <Icon name="plus" size={15} />
          新建会话
        </button>

        <div className={styles.searchRow}>
          <Icon name="search" size={15} className={styles.searchIcon} />
          <input
            className={styles.search}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索标题或内容…"
            spellCheck={false}
            aria-label="搜索会话"
          />
          {search ? (
            <button
              type="button"
              className={styles.clear}
              onClick={() => setSearch('')}
              aria-label="清除搜索"
            >
              <Icon name="close" size={12} />
            </button>
          ) : null}
        </div>

        <div className={styles.filterRow}>
          <FilterableSelect
            options={modelOptions}
            value={modelFilter}
            onChange={setModelFilter}
            size="sm"
            placeholder="全部模型"
            ariaLabel="按模型筛选"
          />
          <FilterableSelect
            options={RANGE_OPTIONS}
            value={range}
            onChange={(value) => setRange(value as Range)}
            size="sm"
            ariaLabel="时间范围"
          />
          <button
            type="button"
            className={`${styles.pinChip} ${pinnedOnly ? styles.pinChipOn : ''}`}
            onClick={() => setPinnedOnly((value) => !value)}
          >
            <Icon name="pin" size={12} />
            仅收藏
          </button>
        </div>

        <div className={styles.sortRow}>
          <span className={styles.sortLabel}>排序</span>
          <FilterableSelect
            options={SORT_OPTIONS}
            value={sort}
            onChange={setSort}
            size="sm"
            ariaLabel="排序字段"
          />
          <button
            type="button"
            className={styles.orderBtn}
            onClick={() => setOrder((value) => (value === 'desc' ? 'asc' : 'desc'))}
            title={order === 'desc' ? '当前：倒序' : '当前：正序'}
            aria-label={order === 'desc' ? '切换为正序' : '切换为倒序'}
          >
            <Icon name={order === 'desc' ? 'sort-desc' : 'sort-asc'} size={14} />
            {order === 'desc' ? '倒序' : '正序'}
          </button>
        </div>
      </div>

      <div className={styles.list}>
        {filtered.length === 0 ? (
          <div className={styles.empty}>没有匹配的会话</div>
        ) : (
          filtered.map((session) => {
            const isStreaming =
              status !== 'idle' && streaming?.sessionId === session.id
            const isActive = session.id === activeSessionId
            const label =
              modelLabels.get(`${session.providerId}::${session.modelId}`) ||
              [session.providerId, session.modelId].filter(Boolean).join(' · ') ||
              '未指定模型'

            return (
              <div
                key={session.id}
                className={`${styles.item} ${isActive ? styles.itemActive : ''}`}
                onClick={() => editingId !== session.id && onSelect(session)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && editingId !== session.id) onSelect(session)
                }}
              >
                <div className={styles.itemTop}>
                  {session.pinned ? <Icon name="pin" size={12} className={styles.pinIcon} /> : null}
                  {editingId === session.id ? (
                    <input
                      className={styles.renameInput}
                      value={editTitle}
                      autoFocus
                      onChange={(event) => setEditTitle(event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => {
                        event.stopPropagation()
                        if (event.key === 'Enter') void commitRename(session.id)
                        if (event.key === 'Escape') setEditingId(null)
                      }}
                      onBlur={() => void commitRename(session.id)}
                    />
                  ) : (
                    <span className={styles.itemTitle}>{session.title || '未命名会话'}</span>
                  )}
                  {isStreaming ? (
                    <span className={styles.streamingBadge}>
                      <span className={styles.pulse} />
                      生成中
                    </span>
                  ) : null}
                </div>

                {session.preview ? (
                  <div className={styles.preview}>{session.preview}</div>
                ) : null}

                <div className={styles.metaRow}>
                  <span className={styles.modelTag} title={label}>
                    {label}
                  </span>
                  <span className={styles.meta}>{session.messageCount} 条消息</span>
                  <span className={styles.meta}>创建 {formatDateTime(session.createdAt)}</span>
                  <span className={styles.meta}>活跃 {formatRelative(session.updatedAt)}</span>
                  {session.sourceUrl ? (
                    <span className={styles.meta}>{formatDomain(session.sourceUrl)}</span>
                  ) : null}
                </div>

                {confirmId !== session.id ? (
                  <div className={styles.actions} onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      title="重命名"
                      aria-label="重命名"
                      onClick={() => {
                        setEditingId(session.id)
                        setEditTitle(session.title)
                      }}
                    >
                      <Icon name="edit" size={13} />
                    </button>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      title={session.pinned ? '取消收藏' : '收藏'}
                      aria-label={session.pinned ? '取消收藏' : '收藏'}
                      onClick={() => void togglePin(session.id).catch((err) => toast(String(err), 'error'))}
                    >
                      <Icon name="pin" size={13} />
                    </button>
                    <button
                      type="button"
                      className={styles.actionBtn}
                      title="删除"
                      aria-label="删除"
                      onClick={() => setConfirmId(session.id)}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                ) : null}

                {confirmId === session.id ? (
                  <div
                    className={styles.confirmRow}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <span className={styles.confirmText}>删除后可在 .trash 中找回</span>
                    <button
                      type="button"
                      className={styles.confirmCancel}
                      onClick={() => setConfirmId(null)}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className={styles.confirmDelete}
                      onClick={() => {
                        setConfirmId(null)
                        void deleteSession(session.id).catch((err) => toast(String(err), 'error'))
                      }}
                    >
                      确认删除
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </Modal>
  )
}
