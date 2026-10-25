import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings, ModelConfig, ProviderConfig, ProtocolId } from '@/shared/types'
import { PROTOCOLS } from '../../api/protocols'
import { rpc } from '../../storage/bridge'
import { applyTheme, saveSettings } from '../../state/chat'
import { useAppStore } from '../../state/store'
import { Button } from '../../ui/Button'
import { FilterableSelect } from '../../ui/FilterableSelect'
import { Icon } from '../../ui/Icon'
import { Modal } from '../../ui/Modal'
import { toast } from '../../ui/Toast'
import { formatTime } from '../../utils/format'
import styles from './SettingsModal.module.css'

interface ProviderPreset {
  key: string
  name: string
  baseUrl: string
  autoV1: boolean
  models: Array<Partial<ModelConfig> & { id: string }>
}

const PRESETS: ProviderPreset[] = [
  {
    key: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    autoV1: true,
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek Chat', contextWindow: 131072, maxOutput: 8192 },
      {
        id: 'deepseek-reasoner',
        label: 'DeepSeek Reasoner',
        contextWindow: 131072,
        maxOutput: 65536,
        reasoning: true,
      },
    ],
  },
  {
    key: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    autoV1: true,
    models: [
      { id: 'gpt-4.1', label: 'GPT-4.1', contextWindow: 1048576, maxOutput: 32768, vision: true },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', contextWindow: 1048576, maxOutput: 32768, vision: true },
    ],
  },
  {
    key: 'moonshot',
    name: 'Moonshot',
    baseUrl: 'https://api.moonshot.cn',
    autoV1: true,
    models: [
      { id: 'moonshot-v1-128k', label: 'Moonshot 128K', contextWindow: 131072, maxOutput: 8192 },
    ],
  },
  {
    key: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    autoV1: false,
    models: [
      { id: 'glm-4-plus', label: 'GLM-4 Plus', contextWindow: 131072, maxOutput: 8192 },
    ],
  },
  {
    key: 'siliconflow',
    name: 'SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn',
    autoV1: true,
    models: [],
  },
  {
    key: 'ollama',
    name: 'Ollama（本地）',
    baseUrl: 'http://localhost:11434',
    autoV1: true,
    models: [],
  },
]

function parseSize(input: string, fallback: number): number {
  const text = input.trim().toLowerCase()
  if (!text) return fallback
  const match = /^(\d+(?:\.\d+)?)\s*([km])?$/.exec(text)
  if (!match) return fallback
  const value = Number(match[1])
  const unit = match[2]
  return Math.round(value * (unit === 'k' ? 1024 : unit === 'm' ? 1024 * 1024 : 1))
}

function formatSize(value: number): string {
  if (!value) return '0'
  if (value >= 1024 * 1024 && value % (1024 * 1024) === 0) return `${value / (1024 * 1024)}M`
  if (value >= 1024 && value % 1024 === 0) return `${value / 1024}K`
  return String(value)
}

function SizeInput({
  value,
  onChange,
  placeholder,
}: {
  value: number
  onChange: (value: number) => void
  placeholder?: string
}) {
  const [text, setText] = useState(() => formatSize(value))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setText(formatSize(value))
  }, [value, focused])

  return (
    <input
      className={styles.input}
      value={text}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        setText(formatSize(value))
      }}
      onChange={(event) => {
        setText(event.target.value)
        const parsed = parseSize(event.target.value, -1)
        if (parsed > 0) onChange(parsed)
      }}
    />
  )
}

function normalizeBase(baseUrl: string, autoV1: boolean | undefined): string {
  let url = baseUrl.trim().replace(/\/+$/, '')
  if (autoV1 !== false && !/\/v\d+$/i.test(url)) url += '/v1'
  return url
}

function emptyProvider(): ProviderConfig {
  return {
    id: crypto.randomUUID().slice(0, 8),
    name: '新渠道',
    protocol: 'openai-completions',
    baseUrl: '',
    apiKey: '',
    autoV1: true,
    temperature: 0.7,
    models: [],
  }
}

function fromPreset(preset: ProviderPreset): ProviderConfig {
  return {
    id: crypto.randomUUID().slice(0, 8),
    name: preset.name,
    protocol: 'openai-completions',
    baseUrl: preset.baseUrl,
    apiKey: '',
    autoV1: preset.autoV1,
    temperature: 0.7,
    models: preset.models.map((model) => ({
      id: model.id,
      label: model.label,
      contextWindow: model.contextWindow ?? 131072,
      maxOutput: model.maxOutput ?? 8192,
      vision: model.vision,
      reasoning: model.reasoning,
      includeUsage: true,
    })),
  }
}

export function SettingsModal() {
  const open = useAppStore((state) => state.settingsOpen)
  const settings = useAppStore((state) => state.settings)
  const patch = useAppStore((state) => state.patch)

  const [tab, setTab] = useState<'providers' | 'tools' | 'general'>('providers')
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showKey, setShowKey] = useState<Record<string, boolean>>({})
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const draftRef = useRef<AppSettings | null>(null)
  draftRef.current = draft

  useEffect(() => {
    if (open && settings) {
      setDraft(structuredClone(settings))
      setExpanded(settings.providers[0]?.id ?? null)
    }
    // 只在打开时初始化，避免保存后回写打断正在编辑的内容
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open || !draft) return
    const timer = setTimeout(() => {
      saveSettings(draft)
        .then(() => {
          setSaveState('saved')
          setSavedAt(Date.now())
        })
        .catch(() => setSaveState('error'))
    }, 700)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, open])

  useEffect(() => {
    return () => {
      const value = draftRef.current
      if (value) void saveSettings(value)
    }
  }, [])

  const updateProvider = (id: string, updater: (provider: ProviderConfig) => ProviderConfig) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            providers: current.providers.map((provider) =>
              provider.id === id ? updater(provider) : provider,
            ),
          }
        : current,
    )
  }

  const updateModel = (
    providerId: string,
    modelIndex: number,
    updater: (model: ModelConfig) => ModelConfig,
  ) => {
    updateProvider(providerId, (provider) => ({
      ...provider,
      models: provider.models.map((model, index) =>
        index === modelIndex ? updater(model) : model,
      ),
    }))
  }

  const addProvider = (preset?: ProviderPreset) => {
    const provider = preset ? fromPreset(preset) : emptyProvider()
    setDraft((current) =>
      current ? { ...current, providers: [...current.providers, provider] } : current,
    )
    setExpanded(provider.id)
  }

  const removeProvider = (id: string) => {
    setDraft((current) => {
      if (!current) return current
      const providers = current.providers.filter((provider) => provider.id !== id)
      let activeModelKey = current.activeModelKey
      if (!providers.some((provider) => activeModelKey.startsWith(`${provider.id}::`))) {
        const first = providers[0]
        activeModelKey = first?.models[0] ? `${first.id}::${first.models[0].id}` : ''
      }
      return { ...current, providers, activeModelKey }
    })
  }

  const testProvider = async (provider: ProviderConfig) => {
    setBusyId(provider.id)
    try {
      const url = `${normalizeBase(provider.baseUrl, provider.autoV1)}/models`
      const headers: Record<string, string> = {}
      if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`
      if (provider.headers) Object.assign(headers, provider.headers)
      const response = await fetch(url, { headers })
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`HTTP ${response.status} ${body.slice(0, 200)}`)
      }
      const data = await response.json()
      const ids: string[] = Array.isArray(data?.data)
        ? data.data.map((item: { id?: string }) => String(item?.id ?? '')).filter(Boolean)
        : []
      if (ids.length === 0) {
        toast('连接成功，但端点没有返回模型列表', 'success')
      } else {
        toast(`连接成功，可用模型 ${ids.length} 个`, 'success')
      }
    } catch (err) {
      toast(`连接失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setBusyId(null)
    }
  }

  const pullModels = async (provider: ProviderConfig) => {
    setBusyId(provider.id)
    try {
      const url = `${normalizeBase(provider.baseUrl, provider.autoV1)}/models`
      const headers: Record<string, string> = {}
      if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`
      if (provider.headers) Object.assign(headers, provider.headers)
      const response = await fetch(url, { headers })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      const ids: string[] = Array.isArray(data?.data)
        ? data.data.map((item: { id?: string }) => String(item?.id ?? '')).filter(Boolean)
        : []
      if (ids.length === 0) {
        toast('端点没有返回模型列表', 'error')
        return
      }
      updateProvider(provider.id, (current) => {
        const existing = new Set(current.models.map((model) => model.id))
        const added = ids
          .filter((id) => !existing.has(id))
          .map<ModelConfig>((id) => ({
            id,
            contextWindow: 131072,
            maxOutput: 8192,
            includeUsage: true,
          }))
        return { ...current, models: [...current.models, ...added] }
      })
      toast(`已添加 ${ids.length} 个模型（如已存在则跳过）`, 'success')
    } catch (err) {
      toast(`拉取失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setBusyId(null)
    }
  }

  const checkNative = async () => {
    try {
      const result = await rpc<{ root: string }>('ping')
      toast(`本地服务正常：${result.root}`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const exportSettings = () => {
    if (!draft) return
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `ridley-ai-settings-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const importSettings = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as AppSettings
      if (!parsed || !Array.isArray(parsed.providers)) throw new Error('文件格式不正确')
      setDraft({ ...parsed, ui: { ...(draft?.ui ?? parsed.ui), ...parsed.ui } })
      toast('已导入配置', 'success')
    } catch (err) {
      toast(`导入失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  const protocolOptions = useMemo(
    () =>
      PROTOCOLS.map((protocol) => ({
        value: protocol.id,
        label: protocol.label,
        disabled: !protocol.implemented,
      })),
    [],
  )

  const updateTools = (patch: Partial<AppSettings['tools']>) => {
    setDraft((current) =>
      current ? { ...current, tools: { ...current.tools, ...patch } } : current,
    )
  }

  const updateSearch = (patch: Partial<AppSettings['tools']['search']>) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            tools: { ...current.tools, search: { ...current.tools.search, ...patch } },
          }
        : current,
    )
  }

  const updateFetch = (patch: Partial<AppSettings['tools']['fetch']>) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            tools: { ...current.tools, fetch: { ...current.tools.fetch, ...patch } },
          }
        : current,
    )
  }

  if (!open) return null

  const handleClose = () => {
    if (draft) {
      void saveSettings(draft).catch(() => toast('保存设置失败', 'error'))
    }
    patch({ settingsOpen: false })
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="设置"
      subtitle="渠道、模型与界面偏好都保存在 ~/.ridley-ai/settings.json"
      width={780}
      fullScreen
      footer={
        <>
          <span className={styles.footerHint}>所有修改都会自动保存，无需手动提交</span>
          <Button variant="primary" onClick={handleClose}>
            完成
          </Button>
        </>
      }
    >
      <div className={styles.tabsRow}>
        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'providers' ? styles.tabActive : ''}`}
            onClick={() => setTab('providers')}
          >
            渠道与模型
          </button>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'tools' ? styles.tabActive : ''}`}
            onClick={() => setTab('tools')}
          >
            工具
          </button>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'general' ? styles.tabActive : ''}`}
            onClick={() => setTab('general')}
          >
            通用
          </button>
        </div>
        <div className={styles.saveHint} aria-live="polite">
          {saveState === 'saved' && savedAt ? (
            <>
              <span className={styles.savedDot} />
              已自动保存 {formatTime(savedAt)}
            </>
          ) : saveState === 'error' ? (
            <span className={styles.saveError}>保存失败</span>
          ) : (
            '修改后自动保存'
          )}
        </div>
      </div>

      {!draft ? null : tab === 'providers' ? (
        <div className={styles.panel}>
          {draft.providers.length === 0 ? (
            <div className={styles.emptyHint}>还没有配置渠道，先从下面的预设添加一个。</div>
          ) : null}

          {draft.providers.map((provider) => {
            const isOpen = expanded === provider.id
            const keyVisible = showKey[provider.id] ?? false
            return (
              <div key={provider.id} className={styles.providerCard}>
                <button
                  type="button"
                  className={styles.providerHead}
                  onClick={() => setExpanded(isOpen ? null : provider.id)}
                >
                  <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={14} />
                  <span className={styles.providerName}>{provider.name || '未命名渠道'}</span>
                  <span className={styles.providerMeta}>
                    {provider.models.length} 个模型
                    {provider.apiKey ? ' · 已配置 Key' : ' · 无 Key'}
                  </span>
                </button>

                {isOpen ? (
                  <div className={styles.providerBody}>
                    <div className={styles.grid2}>
                      <label className={styles.field}>
                        <span className={styles.label}>名称</span>
                        <input
                          className={styles.input}
                          value={provider.name}
                          onChange={(event) =>
                            updateProvider(provider.id, (current) => ({
                              ...current,
                              name: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className={styles.field}>
                        <span className={styles.label}>接口协议</span>
                        <FilterableSelect
                          options={protocolOptions}
                          value={provider.protocol}
                          onChange={(value) =>
                            updateProvider(provider.id, (current) => ({
                              ...current,
                              protocol: value as ProtocolId,
                            }))
                          }
                          ariaLabel="接口协议"
                          className={styles.selectFull}
                        />
                      </label>
                    </div>

                    <label className={styles.field}>
                      <span className={styles.label}>Base URL</span>
                      <input
                        className={styles.input}
                        value={provider.baseUrl}
                        placeholder="https://api.deepseek.com"
                        onChange={(event) =>
                          updateProvider(provider.id, (current) => ({
                            ...current,
                            baseUrl: event.target.value,
                          }))
                        }
                      />
                      <span className={styles.hint}>
                        实际请求地址：{normalizeBase(provider.baseUrl || '…', provider.autoV1)}
                        /chat/completions
                      </span>
                    </label>

                    <label className={styles.field}>
                      <span className={styles.label}>API Key</span>
                      <div className={styles.keyRow}>
                        <input
                          className={styles.input}
                          type={keyVisible ? 'text' : 'password'}
                          value={provider.apiKey}
                          placeholder="sk-…"
                          onChange={(event) =>
                            updateProvider(provider.id, (current) => ({
                              ...current,
                              apiKey: event.target.value,
                            }))
                          }
                        />
                        <button
                          type="button"
                          className={styles.iconBtn}
                          onClick={() =>
                            setShowKey((current) => ({
                              ...current,
                              [provider.id]: !keyVisible,
                            }))
                          }
                          aria-label={keyVisible ? '隐藏密钥' : '显示密钥'}
                        >
                          <Icon name={keyVisible ? 'eye-off' : 'eye'} size={15} />
                        </button>
                      </div>
                    </label>

                    <div className={styles.grid2}>
                      <label className={styles.field}>
                        <span className={styles.label}>默认温度</span>
                        <input
                          className={styles.input}
                          type="number"
                          step="0.1"
                          min="0"
                          max="2"
                          value={provider.temperature ?? ''}
                          onChange={(event) =>
                            updateProvider(provider.id, (current) => ({
                              ...current,
                              temperature:
                                event.target.value === '' ? undefined : Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                      <label className={styles.checkboxField}>
                        <input
                          type="checkbox"
                          checked={provider.autoV1 !== false}
                          onChange={(event) =>
                            updateProvider(provider.id, (current) => ({
                              ...current,
                              autoV1: event.target.checked,
                            }))
                          }
                        />
                        <span>自动补 /v1</span>
                      </label>
                    </div>

                    <div className={styles.rowActions}>
                      <Button
                        size="sm"
                        onClick={() => void pullModels(provider)}
                        disabled={busyId === provider.id || !provider.baseUrl}
                      >
                        {busyId === provider.id ? '请稍候…' : '拉取模型'}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => void testProvider(provider)}
                        disabled={busyId === provider.id || !provider.baseUrl}
                      >
                        测试连接
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => removeProvider(provider.id)}
                      >
                        删除渠道
                      </Button>
                    </div>

                    <div className={styles.modelSection}>
                      <div className={styles.sectionHead}>
                        <span className={styles.sectionTitle}>模型</span>
                        <Button
                          size="sm"
                          onClick={() =>
                            updateProvider(provider.id, (current) => ({
                              ...current,
                              models: [
                                ...current.models,
                                {
                                  id: '',
                                  contextWindow: 131072,
                                  maxOutput: 8192,
                                  includeUsage: true,
                                },
                              ],
                            }))
                          }
                        >
                          <Icon name="plus" size={13} />
                          添加模型
                        </Button>
                      </div>

                      {provider.models.length === 0 ? (
                        <div className={styles.emptyHint}>还没有模型，可点「拉取模型」或手动添加。</div>
                      ) : null}

                      {provider.models.map((model, index) => (
                        <div key={index} className={styles.modelRow}>
                          <div className={styles.grid2}>
                            <label className={styles.field}>
                              <span className={styles.label}>模型 ID</span>
                              <input
                                className={styles.input}
                                value={model.id}
                                placeholder="deepseek-chat"
                                onChange={(event) =>
                                  updateModel(provider.id, index, (current) => ({
                                    ...current,
                                    id: event.target.value,
                                  }))
                                }
                              />
                            </label>
                            <label className={styles.field}>
                              <span className={styles.label}>显示名</span>
                              <input
                                className={styles.input}
                                value={model.label ?? ''}
                                placeholder="可留空"
                                onChange={(event) =>
                                  updateModel(provider.id, index, (current) => ({
                                    ...current,
                                    label: event.target.value || undefined,
                                  }))
                                }
                              />
                            </label>
                          </div>

                          <div className={styles.grid3}>
                            <label className={styles.field}>
                              <span className={styles.label}>上下文窗口</span>
                              <SizeInput
                                value={model.contextWindow}
                                onChange={(value) =>
                                  updateModel(provider.id, index, (current) => ({
                                    ...current,
                                    contextWindow: value,
                                  }))
                                }
                              />
                            </label>
                            <label className={styles.field}>
                              <span className={styles.label}>最大输出</span>
                              <SizeInput
                                value={model.maxOutput}
                                onChange={(value) =>
                                  updateModel(provider.id, index, (current) => ({
                                    ...current,
                                    maxOutput: value,
                                  }))
                                }
                              />
                            </label>
                            <label className={styles.field}>
                              <span className={styles.label}>温度</span>
                              <input
                                className={styles.input}
                                type="number"
                                step="0.1"
                                min="0"
                                max="2"
                                value={model.temperature ?? ''}
                                placeholder="继承"
                                onChange={(event) =>
                                  updateModel(provider.id, index, (current) => ({
                                    ...current,
                                    temperature:
                                      event.target.value === ''
                                        ? undefined
                                        : Number(event.target.value),
                                  }))
                                }
                              />
                            </label>
                          </div>

                          <div className={styles.checks}>
                            <label className={styles.checkboxField}>
                              <input
                                type="checkbox"
                                checked={Boolean(model.vision)}
                                onChange={(event) =>
                                  updateModel(provider.id, index, (current) => ({
                                    ...current,
                                    vision: event.target.checked,
                                  }))
                                }
                              />
                              <span>支持图片</span>
                            </label>
                            <label className={styles.checkboxField}>
                              <input
                                type="checkbox"
                                checked={Boolean(model.reasoning)}
                                onChange={(event) =>
                                  updateModel(provider.id, index, (current) => ({
                                    ...current,
                                    reasoning: event.target.checked,
                                  }))
                                }
                              />
                              <span>推理模型</span>
                            </label>
                            <label className={styles.checkboxField}>
                              <input
                                type="checkbox"
                                checked={model.tools !== false}
                                onChange={(event) =>
                                  updateModel(provider.id, index, (current) => ({
                                    ...current,
                                    tools: event.target.checked,
                                  }))
                                }
                              />
                              <span>支持工具调用</span>
                            </label>
                            <label className={styles.checkboxField}>
                              <input
                                type="checkbox"
                                checked={model.includeUsage !== false}
                                onChange={(event) =>
                                  updateModel(provider.id, index, (current) => ({
                                    ...current,
                                    includeUsage: event.target.checked,
                                  }))
                                }
                              />
                              <span>返回用量</span>
                            </label>
                            <label className={styles.checkboxField}>
                              <input
                                type="checkbox"
                                checked={Boolean(model.useMaxCompletionTokens)}
                                onChange={(event) =>
                                  updateModel(provider.id, index, (current) => ({
                                    ...current,
                                    useMaxCompletionTokens: event.target.checked,
                                  }))
                                }
                              />
                              <span>用 max_completion_tokens</span>
                            </label>
                          </div>

                          <div className={styles.modelFoot}>
                            <button
                              type="button"
                              className={styles.removeModel}
                              onClick={() =>
                                updateProvider(provider.id, (current) => ({
                                  ...current,
                                  models: current.models.filter((_, i) => i !== index),
                                }))
                              }
                            >
                              <Icon name="trash" size={12} />
                              删除此模型
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}

          <div className={styles.addRow}>
            <span className={styles.addLabel}>添加渠道</span>
            <div className={styles.presetChips}>
              {PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  className={styles.presetChip}
                  onClick={() => addProvider(preset)}
                >
                  + {preset.name}
                </button>
              ))}
              <button type="button" className={styles.presetChip} onClick={() => addProvider()}>
                + 空白渠道
              </button>
            </div>
          </div>
        </div>
      ) : tab === 'tools' ? (
        <div className={styles.panel}>
          <div className={styles.group}>
            <div className={styles.groupTitle}>网页搜索 · web_search</div>
            <label className={styles.checkboxField}>
              <input
                type="checkbox"
                checked={draft.tools.search.enabled}
                onChange={(event) => updateSearch({ enabled: event.target.checked })}
              />
              <span>允许模型搜索网页</span>
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Search API 地址</span>
              <input
                className={styles.input}
                value={draft.tools.search.baseUrl}
                placeholder="https://api.deepseek.com/v1/tools/search"
                onChange={(event) => updateSearch({ baseUrl: event.target.value })}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>API Key</span>
              <div className={styles.keyRow}>
                <input
                  className={styles.input}
                  type={showKey.search ? 'text' : 'password'}
                  value={draft.tools.search.apiKey}
                  placeholder="sk-…（通常与 DeepSeek 渠道的 Key 相同）"
                  onChange={(event) => updateSearch({ apiKey: event.target.value })}
                />
                <button
                  type="button"
                  className={styles.iconBtn}
                  onClick={() =>
                    setShowKey((current) => ({ ...current, search: !current.search }))
                  }
                  aria-label={showKey.search ? '隐藏密钥' : '显示密钥'}
                >
                  <Icon name={showKey.search ? 'eye-off' : 'eye'} size={15} />
                </button>
              </div>
            </label>

            <div className={styles.grid2}>
              <label className={styles.field}>
                <span className={styles.label}>最多返回来源</span>
                <input
                  className={styles.input}
                  type="number"
                  min={1}
                  max={50}
                  value={draft.tools.search.maxResults}
                  onChange={(event) => updateSearch({ maxResults: Number(event.target.value) })}
                />
              </label>
            </div>

            <div className={styles.hint}>
              官方 Search API：<code>POST https://api.deepseek.com/v1/tools/search</code>。
              与模型使用同一个 API Key 和账户余额，按成功请求计费。搜索失败或零结果不收费。
            </div>
          </div>

          <div className={styles.group}>
            <div className={styles.groupTitle}>网页抓取 · web_fetch</div>
            <label className={styles.checkboxField}>
              <input
                type="checkbox"
                checked={draft.tools.fetch.enabled}
                onChange={(event) => updateFetch({ enabled: event.target.checked })}
              />
              <span>允许模型读取网页正文</span>
            </label>

            <label className={styles.field}>
              <span className={styles.label}>抓取方式</span>
              <div className={styles.segment}>
                <button
                  type="button"
                  className={`${styles.segmentBtn} ${draft.tools.fetch.mode === 'local' ? styles.segmentActive : ''}`}
                  onClick={() => updateFetch({ mode: 'local' })}
                >
                  本地直接抓取
                </button>
                <button
                  type="button"
                  className={`${styles.segmentBtn} ${draft.tools.fetch.mode === 'remote' ? styles.segmentActive : ''}`}
                  onClick={() => updateFetch({ mode: 'remote' })}
                >
                  官方 Fetch API
                </button>
              </div>
            </label>

            {draft.tools.fetch.mode === 'remote' ? (
              <>
                <label className={styles.field}>
                  <span className={styles.label}>Fetch API 地址</span>
                  <input
                    className={styles.input}
                    value={draft.tools.fetch.baseUrl}
                    placeholder="https://api.deepseek.com/v1/tools/fetch"
                    onChange={(event) => updateFetch({ baseUrl: event.target.value })}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>API Key</span>
                  <div className={styles.keyRow}>
                    <input
                      className={styles.input}
                      type={showKey.fetch ? 'text' : 'password'}
                      value={draft.tools.fetch.apiKey}
                      placeholder="留空则复用搜索的 Key"
                      onChange={(event) => updateFetch({ apiKey: event.target.value })}
                    />
                    <button
                      type="button"
                      className={styles.iconBtn}
                      onClick={() =>
                        setShowKey((current) => ({ ...current, fetch: !current.fetch }))
                      }
                      aria-label={showKey.fetch ? '隐藏密钥' : '显示密钥'}
                    >
                      <Icon name={showKey.fetch ? 'eye-off' : 'eye'} size={15} />
                    </button>
                  </div>
                </label>
                <div className={styles.hint}>
                  官方 Fetch API：<code>POST https://api.deepseek.com/v1/tools/fetch</code>，
                  请求 <code>{'{"url": "..."}'}</code>，返回 <code>{'{"title","content"}'}</code>。
                  与模型共用同一个 Key；按成功请求计费。
                </div>
              </>
            ) : (
              <label className={styles.checkboxField}>
                <input
                  type="checkbox"
                  checked={draft.tools.fetch.allowPrivateHosts}
                  onChange={(event) => updateFetch({ allowPrivateHosts: event.target.checked })}
                />
                <span>允许访问 localhost / 内网地址</span>
              </label>
            )}

            <label className={styles.field} style={{ maxWidth: 220 }}>
              <span className={styles.label}>返回给模型的最大字符数</span>
              <input
                className={styles.input}
                type="number"
                min={1000}
                step={1000}
                value={draft.tools.fetch.maxChars}
                onChange={(event) => updateFetch({ maxChars: Number(event.target.value) })}
              />
            </label>
            <div className={styles.hint}>
              本地抓取会直接请求目标页面并转换为 Markdown（单页上限 2MB、超时由整体取消控制）。
            </div>
          </div>

          <div className={styles.group}>
            <div className={styles.groupTitle}>调用策略</div>
            <label className={styles.field} style={{ maxWidth: 260 }}>
              <span className={styles.label}>工具调用轮次上限（0 = 不限制，最大 50）</span>
              <input
                className={styles.input}
                type="number"
                min={0}
                max={50}
                value={draft.tools.maxRounds ?? 5}
                onChange={(event) => updateTools({ maxRounds: Number(event.target.value) })}
              />
            </label>
            <div className={styles.hint}>
              达到上限后不会中断会话：剩下的工具调用会收到「已到上限」的结果，
              随后再发一次不带工具的请求，让模型基于已有信息给出最终回答。
              填 0 表示不限制轮次（内部仍保留 100 轮作为防死循环的保险）。
            </div>
          </div>

          <div className={styles.group}>
            <div className={styles.groupTitle}>说明</div>
            <div className={styles.hint}>
              工具仅在「模型配置」里勾选了「支持工具调用」的模型上生效。模型可以自主决定是否调用、
              调用几次，每次调用都会在对话中显示可展开的卡片。
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.panel}>
          <div className={styles.group}>
            <div className={styles.groupTitle}>外观</div>
            <div className={styles.segment}>
              {(['light', 'dark', 'system'] as const).map((theme) => (
                <button
                  key={theme}
                  type="button"
                  className={`${styles.segmentBtn} ${draft.ui.theme === theme ? styles.segmentActive : ''}`}
                  onClick={() => {
                    const next = { ...draft, ui: { ...draft.ui, theme } }
                    setDraft(next)
                    applyTheme(theme)
                  }}
                >
                  {theme === 'light' ? '亮色' : theme === 'dark' ? '暗色' : '跟随系统'}
                </button>
              ))}
            </div>

            <label className={styles.field}>
              <span className={styles.label}>正文字号（12–17px）</span>
              <div className={styles.sliderRow}>
                <input
                  type="range"
                  min={12}
                  max={17}
                  step={1}
                  value={draft.ui.fontSize}
                  onChange={(event) =>
                    setDraft({ ...draft, ui: { ...draft.ui, fontSize: Number(event.target.value) } })
                  }
                />
                <span className={styles.sliderValue}>{draft.ui.fontSize}px</span>
              </div>
            </label>
          </div>

          <div className={styles.group}>
            <div className={styles.groupTitle}>交互</div>
            <label className={styles.checkboxField}>
              <input
                type="checkbox"
                checked={draft.ui.enterToSend}
                onChange={(event) =>
                  setDraft({ ...draft, ui: { ...draft.ui, enterToSend: event.target.checked } })
                }
              />
              <span>Enter 发送，Shift+Enter 换行</span>
            </label>
            <label className={styles.checkboxField}>
              <input
                type="checkbox"
                checked={draft.ui.showReasoning}
                onChange={(event) =>
                  setDraft({ ...draft, ui: { ...draft.ui, showReasoning: event.target.checked } })
                }
              />
              <span>显示模型的思考过程</span>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>右键带入选中内容后</span>
              <div className={styles.segment}>
                {(['insert', 'send'] as const).map((behavior) => (
                  <button
                    key={behavior}
                    type="button"
                    className={`${styles.segmentBtn} ${draft.ui.selectionBehavior === behavior ? styles.segmentActive : ''}`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        ui: { ...draft.ui, selectionBehavior: behavior },
                      })
                    }
                  >
                    {behavior === 'insert' ? '放入输入框，等我发送' : '直接发送'}
                  </button>
                ))}
              </div>
            </label>
          </div>

          <div className={styles.group}>
            <div className={styles.groupTitle}>数据</div>
            <div className={styles.dataRow}>
              <Button size="sm" onClick={checkNative}>
                检查本地服务
              </Button>
              <Button size="sm" onClick={exportSettings}>
                导出配置
              </Button>
              <Button size="sm" onClick={() => importRef.current?.click()}>
                导入配置
              </Button>
              <input
                ref={importRef}
                type="file"
                accept="application/json"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void importSettings(file)
                  event.target.value = ''
                }}
              />
            </div>
            <div className={styles.hint}>
              聊天记录保存在 C:\Users\{'{用户名}'}\.ridley-ai，可直接备份该目录。
              API Key 以明文保存在同一目录的 settings.json 中。
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
