import logo from '../assets/logo.png'
import { cn } from '@/lib/utils'

type BrandWordmarkSize = 'sm' | 'md' | 'lg'

const sizeClasses: Record<BrandWordmarkSize, { logo: string; text: string }> = {
  sm: { logo: 'w-5 h-5 translate-y-[2px]', text: 'text-sm translate-y-[2px]' },
  md: { logo: 'w-6 h-6 translate-y-[2.5px]', text: 'text-xl translate-y-[2.5px]' },
  lg: { logo: 'w-7 h-7 translate-y-[3px]', text: 'text-[22px] translate-y-[3px]' },
}

const wordmarkColor = 'text-white'

export default function BrandWordmark({
  size = 'sm',
  className,
  logoClassName,
  textClassName,
  logoOnly = false,
}: {
  size?: BrandWordmarkSize
  className?: string
  logoClassName?: string
  textClassName?: string
  logoOnly?: boolean
}) {
  return (
    <span className={cn('inline-flex items-end gap-0 whitespace-nowrap align-baseline', className)}>
      <img
        src={logo}
        alt=""
        aria-hidden="true"
        className={cn('shrink-0 object-contain', sizeClasses[size].logo, logoClassName)}
      />
      {!logoOnly && (
        <span
          aria-hidden="true"
          className={cn(
            'font-semibold leading-none tracking-normal',
            sizeClasses[size].text,
            textClassName,
            wordmarkColor,
          )}
        >
          aultage
        </span>
      )}
      <span className="sr-only">Vaultage</span>
    </span>
  )
}
