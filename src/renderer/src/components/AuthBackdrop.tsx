import { AnimatedGradient } from './AnimatedGradient'
import {
  CLOSED_AUTH_BACKDROP_CONTRACT,
  OPEN_AUTH_BACKDROP_CONTRACT,
} from '../lib/editionTheme'

export default function AuthBackdrop() {
  if (__VAULTAGE_OPEN_CORE__) {
    const backdrop = OPEN_AUTH_BACKDROP_CONTRACT

    return (
      <>
        <AnimatedGradient
          variant="vortex"
          palette={backdrop.gradientPalette}
          speed={backdrop.gradientSpeed}
          opacity={backdrop.gradientOpacity}
          className="absolute inset-0 pointer-events-none"
        />
        <div className={backdrop.overlayClassName} />
        <div
          className={backdrop.patternClassName}
          style={{
            backgroundImage: backdrop.patternImages.join(', '),
          }}
        />
      </>
    )
  }

  const backdrop = CLOSED_AUTH_BACKDROP_CONTRACT

  return (
    <>
      <AnimatedGradient
        variant="vortex"
        palette={backdrop.gradientPalette}
        speed={backdrop.gradientSpeed}
        opacity={backdrop.gradientOpacity}
        className="absolute inset-0 pointer-events-none"
      />
      <div className={backdrop.overlayClassName} />
      <div className={backdrop.noiseClassName} />
    </>
  )
}
