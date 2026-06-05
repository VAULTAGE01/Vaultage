import { Bot } from 'lucide-react'

export function RobotModel() {
  return (
    <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-accent shadow-[0_0_24px_rgba(0,255,127,0.12)]">
      <Bot className="h-8 w-8" strokeWidth={1.8} aria-hidden="true" />
    </div>
  )
}
