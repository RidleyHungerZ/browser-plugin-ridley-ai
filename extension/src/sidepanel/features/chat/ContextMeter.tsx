import { estimateMessagesTokens, estimateTextTokens } from '../../api/tokens'
import { resolveActiveModel } from '../../state/chat'
import { useAppStore } from '../../state/store'
import { formatCount } from '../../utils/format'
import styles from './ContextMeter.module.css'

export function ContextMeter() {
  const settings = useAppStore((state) => state.settings)
  const messages = useAppStore((state) => state.messages)
  const draftText = useAppStore((state) => state.draftText)
  const quote = useAppStore((state) => state.quote)

  if (!settings) return null
  const { model } = resolveActiveModel(settings)
  if (!model) return null

  const used =
    estimateMessagesTokens(messages) + estimateTextTokens(draftText + (quote?.text ?? ''))
  const ratio = Math.min(1, used / Math.max(1, model.contextWindow))
  const radius = 8
  const circumference = 2 * Math.PI * radius
  const color =
    ratio > 0.92 ? 'var(--rds-danger)' : ratio > 0.75 ? 'var(--rds-warn)' : 'var(--rds-brand)'

  return (
    <div
      className={styles.meter}
      title={`上下文约 ${formatCount(used)} / ${formatCount(model.contextWindow)} tokens`}
      aria-label="上下文占用"
    >
      <svg width={20} height={20} viewBox="0 0 20 20">
        <circle cx="10" cy="10" r={radius} fill="none" stroke="var(--rds-border)" strokeWidth="2" />
        <circle
          cx="10"
          cy="10"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          transform="rotate(-90 10 10)"
          style={{ transition: 'stroke-dashoffset 0.3s var(--rds-ease)' }}
        />
      </svg>
    </div>
  )
}
