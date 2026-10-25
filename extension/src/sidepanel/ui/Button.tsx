import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './Button.module.css'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'subtle' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  iconOnly?: boolean
  children?: ReactNode
}

export function Button({
  variant = 'subtle',
  size = 'md',
  iconOnly = false,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={[
        styles.btn,
        styles[variant],
        styles[size],
        iconOnly ? styles.iconOnly : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </button>
  )
}
