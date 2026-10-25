import { useMemo } from 'react'
import { modelKey, type AppSettings } from '@/shared/types'
import { setActiveModel } from '../../state/chat'
import { useAppStore } from '../../state/store'
import { FilterableSelect, type SelectOption } from '../../ui/FilterableSelect'
import styles from './ModelPicker.module.css'

function buildOptions(settings: AppSettings): SelectOption[] {
  const findModel = (key: string) => {
    const idx = key.indexOf('::')
    if (idx < 0) return null
    const provider = settings.providers.find((item) => item.id === key.slice(0, idx))
    const model = provider?.models.find((item) => item.id === key.slice(idx + 2))
    return provider && model ? { provider, model } : null
  }

  const recent = settings.recentModels
    .map((key) => ({ key, found: findModel(key) }))
    .filter((item) => item.found)
    .map((item) => item.key)

  const recentSet = new Set(recent)
  const options: SelectOption[] = []

  for (const key of recent) {
    const found = findModel(key)!
    options.push({
      value: key,
      label: found.model.label || found.model.id,
      hint: `${found.provider.name}${found.model.vision ? ' · 图片' : ''}`,
      group: '__recent',
      groupLabel: '最近使用',
    })
  }

  for (const provider of settings.providers) {
    for (const model of provider.models) {
      const key = modelKey(provider.id, model.id)
      if (recentSet.has(key)) continue
      options.push({
        value: key,
        label: model.label || model.id,
        hint: `${provider.name} · ${model.id}${model.vision ? ' · 图片' : ''}`,
        group: provider.id,
        groupLabel: provider.name,
      })
    }
  }

  return options
}

export function ModelPicker() {
  const settings = useAppStore((state) => state.settings)
  const options = useMemo(() => (settings ? buildOptions(settings) : []), [settings])

  if (!settings) return null

  const value = settings.activeModelKey
  const selected = options.find((option) => option.value === value) ?? null
  const providerName = selected?.hint?.split(' · ')[0] ?? ''

  return (
    <FilterableSelect
      options={options}
      value={value}
      onChange={(key) => void setActiveModel(key)}
      placeholder="选择模型"
      emptyText="没有可用模型，请先在设置中添加"
      ariaLabel="选择模型"
      title={selected ? `${providerName} · ${selected.label}` : '选择模型'}
      className={styles.picker}
      trigger={(option) =>
        option ? (
          <span className={styles.trigger}>
            <span className={styles.provider}>{providerName}</span>
            <span className={styles.sep}>·</span>
            <span className={styles.model}>{option.label}</span>
          </span>
        ) : (
          <span className={styles.placeholder}>选择模型</span>
        )
      }
    />
  )
}
