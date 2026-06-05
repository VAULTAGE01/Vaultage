import React from 'react'

interface LogoProps extends React.SVGProps<SVGSVGElement> {
  className?: string
  monochrome?: boolean
}

export function VaultageLogoIcon({ className, monochrome = false, ...props }: LogoProps) {
  const fill1 = monochrome ? "currentColor" : "url(#vaultage-slab-grad-1)"
  const fill2 = monochrome ? "currentColor" : "url(#vaultage-slab-grad-2)"
  const fill3 = monochrome ? "currentColor" : "url(#vaultage-slab-grad-3)"
  
  return (
    <svg
      viewBox="10 15 110 120"
      fill="none"
      className={className}
      {...props}
    >
      {!monochrome && (
        <defs>
          <linearGradient id="vaultage-slab-grad-1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#e665ff" />
            <stop offset="50%" stopColor="#8538ff" />
            <stop offset="100%" stopColor="#39a9ff" />
          </linearGradient>
          <linearGradient id="vaultage-slab-grad-2" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#9a36ff" />
            <stop offset="50%" stopColor="#4f47ff" />
            <stop offset="100%" stopColor="#32bdff" />
          </linearGradient>
          <linearGradient id="vaultage-slab-grad-3" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#4a69ff" />
            <stop offset="50%" stopColor="#168cff" />
            <stop offset="100%" stopColor="#15d7ff" />
          </linearGradient>
        </defs>
      )}
      {/* Slab 1 */}
      <path
        d="M 114.24 65 L 113 66.34 L 110 67.09 L 41 58.46 L 37.77 56 L 14.48 27 L 14.6 23 L 16 21.82 L 19 21.61 L 90 31.9 L 93.33 34 L 113.66 60 L 114.5 62 Z"
        fill={fill1}
      />
      {/* Slab 2 */}
      <path
        d="M 108.42 98 L 107 99.26 L 104 99.5 L 52 93.39 L 48.94 91 L 34.75 73 L 30.77 67 L 30.78 65 L 32 63.45 L 34 62.58 L 87 69.69 L 90 70.63 L 91.98 72 L 108.12 93 L 109.12 96 Z"
        fill={fill2}
      />
      {/* Slab 3 */}
      <path
        d="M 100.41 126 L 98 127.52 L 91 127.46 L 69 125.42 L 64 124.36 L 60.92 122 L 46.76 103 L 46.59 100 L 48 98.53 L 50 98.43 L 85 102.73 L 88.11 105 L 100.31 122 L 100.88 124 Z"
        fill={fill3}
      />
    </svg>
  )
}

export function VaultageLogoWordmark({ className, monochrome = false, ...props }: LogoProps) {
  const fill1 = monochrome ? "currentColor" : "url(#vaultage-slab-grad-1)"
  const fill2 = monochrome ? "currentColor" : "url(#vaultage-slab-grad-2)"
  const fill3 = monochrome ? "currentColor" : "url(#vaultage-slab-grad-3)"
  const textFill = "currentColor"

  return (
    <svg
      viewBox="0 0 450 157"
      fill="none"
      className={className}
      {...props}
    >
      {!monochrome && (
        <defs>
          <linearGradient id="vaultage-slab-grad-1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#e665ff" />
            <stop offset="50%" stopColor="#8538ff" />
            <stop offset="100%" stopColor="#39a9ff" />
          </linearGradient>
          <linearGradient id="vaultage-slab-grad-2" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#9a36ff" />
            <stop offset="50%" stopColor="#4f47ff" />
            <stop offset="100%" stopColor="#32bdff" />
          </linearGradient>
          <linearGradient id="vaultage-slab-grad-3" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#4a69ff" />
            <stop offset="50%" stopColor="#168cff" />
            <stop offset="100%" stopColor="#15d7ff" />
          </linearGradient>
        </defs>
      )}
      {/* Slabs */}
      <path
        d="M 114.24 65 L 113 66.34 L 110 67.09 L 41 58.46 L 37.77 56 L 14.48 27 L 14.6 23 L 16 21.82 L 19 21.61 L 90 31.9 L 93.33 34 L 113.66 60 L 114.5 62 Z"
        fill={fill1}
      />
      <path
        d="M 108.42 98 L 107 99.26 L 104 99.5 L 52 93.39 L 48.94 91 L 34.75 73 L 30.77 67 L 30.78 65 L 32 63.45 L 34 62.58 L 87 69.69 L 90 70.63 L 91.98 72 L 108.12 93 L 109.12 96 Z"
        fill={fill2}
      />
      <path
        d="M 100.41 126 L 98 127.52 L 91 127.46 L 69 125.42 L 64 124.36 L 60.92 122 L 46.76 103 L 46.59 100 L 48 98.53 L 50 98.43 L 85 102.73 L 88.11 105 L 100.31 122 L 100.88 124 Z"
        fill={fill3}
      />
      {/* Text "aultage" */}
      <path
        d="M 332 143.24 L 327.65 139 L 326.52 137 L 325.63 134 L 326 133.63 L 336 133.61 L 338 136.32 L 342 138.23 L 348 138.38 L 352 137.38 L 354.36 136 L 356.46 133 L 357.18 129 L 357.18 122 L 356 121.42 L 352.97 125 L 349 127.37 L 343 128.44 L 336 127.25 L 332 125.1 L 332 125.1 L 330 123.35 L 326.77 119 L 324.56 113 L 323.95 107 L 324.57 100 L 326.75 94 L 328.62 91 L 332 87.74 L 338 84.96 L 345 84.52 L 349 85.52 L 352.98 88 L 356 91.8 L 357 92.1 L 357.09 86 L 358 85.18 L 367 85.18 L 367.54 86 L 367.54 129 L 366.86 134 L 365.19 138 L 361 142.34 L 357 144.5 L 351 146.08 L 341 146.21 L 337 145.35 Z M 286 130.37 L 281 127.53 L 278.74 125 L 277.79 123 L 276.74 117 L 277.57 113 L 278.54 111 L 282 107.53 L 285 105.85 L 289 104.63 L 305 103.43 L 305.56 102 L 305.26 97 L 304 95.05 L 302 93.55 L 297 92.54 L 292 93.53 L 290 94.81 L 288 97.4 L 279 97.38 L 278.71 96 L 279.68 93 L 281.76 90 L 284.16 88 L 288 85.81 L 292 84.67 L 303 84.59 L 307 85.73 L 312 89.13 L 314.29 92 L 315.47 95 L 316.05 100 L 316.05 130 L 315 130.51 L 306 130.44 L 305.56 130 L 305.55 125 L 305 124.44 L 301.62 128 L 297 130.49 L 292 131.32 Z M 136 130.37 L 131 127.53 L 128.74 125 L 127.79 123 L 126.74 117 L 127.57 113 L 128.54 111 L 132 107.53 L 135 105.85 L 139 104.63 L 155 103.43 L 155.56 102 L 155.26 97 L 154 95.05 L 152 93.55 L 147 92.54 L 142 93.53 L 140 94.81 L 138 97.4 L 129 97.38 L 128.71 96 L 129.68 93 L 131.76 90 L 134.16 88 L 138 85.81 L 142 84.67 L 153 84.59 L 157 85.73 L 162 89.13 L 164.29 92 L 165.47 95 L 166.05 100 L 166.05 130 L 165 130.51 L 156 130.44 L 155.56 130 L 155.55 125 L 155 124.44 L 151.62 128 L 147 130.49 L 142 131.32 Z M 405 130.41 L 397 131.44 L 390 130.39 L 387 129.19 L 384 127.33 L 381 124.59 L 377.99 120 L 376.57 116 L 375.55 107 L 376.53 100 L 377.87 96 L 381 91.15 L 385 87.55 L 391 84.84 L 397 84.31 L 402 84.72 L 407 86.58 L 412.49 91 L 415.22 95 L 417.21 101 L 417.6 110 L 417 110.47 L 387 110.47 L 386.17 111 L 386.65 115 L 387.93 118 L 391 121.39 L 393 122.39 L 397 123.23 L 402 122.46 L 404.6 121 L 408 118.07 L 416 118.05 L 417 119 L 415.2 123 L 412.54 126 L 408 129.22 Z M 180 127.26 L 177.72 124 L 176.67 121 L 175.83 115 L 176 85.63 L 177 85.18 L 186 85.32 L 186.43 86 L 186.72 116 L 189 120.4 L 192 122.1 L 195 122.51 L 199 121.82 L 202 120.14 L 204.57 116 L 205.37 111 L 205.37 86 L 206 85.18 L 215 85.18 L 215.72 86 L 215.72 130 L 215 130.51 L 206 130.51 L 205.37 130 L 205 123.7 L 200 129.12 L 194 131.32 L 189 131.27 L 185 130.38 Z M 270 130.45 L 262 130.52 L 257 129.4 L 254 127.44 L 251.72 124 L 250.89 118 L 250.89 94 L 250 93.31 L 244.25 93 L 243.82 92 L 243.82 86 L 245 85.18 L 250.32 85 L 250.89 84 L 250.89 75 L 252 73.95 L 261 73.95 L 261.57 75 L 261.91 85 L 270 85.18 L 271.27 86 L 270.9 93 L 262 93.39 L 261.57 94 L 261.79 118 L 262.56 120 L 264 121.44 L 266 122.2 L 270 122.34 L 271.27 123 L 271.06 130 Z M 236 130.51 L 227 130.51 L 226.46 130 L 226.46 69 L 227 67.52 L 236 67.52 L 236.85 68 L 236.9 130 Z M 346 120.04 L 350 119.33 L 352 118.35 L 354.44 116 L 356.13 113 L 357.29 107 L 356.4 101 L 354.37 97 L 352 94.77 L 350 93.79 L 346 93.16 L 342 93.67 L 340 94.63 L 337.53 97 L 335.79 100 L 334.66 107 L 335.74 113 L 337.47 116 L 340 118.45 L 342 119.42 Z M 287.88 120 L 290.09 122 L 294 123.2 L 300 122.23 L 303 120.1 L 305.39 116 L 305.56 111 L 305 110.37 L 298 110.66 L 291 111.76 L 289 112.91 L 287.53 115 L 287.24 117 Z M 137.88 120 L 140.09 122 L 144 123.2 L 150 122.23 L 153 120.1 L 155.39 116 L 155.56 111 L 155 110.37 L 148 110.66 L 141 111.76 L 139 112.91 L 137.53 115 L 137.24 117 Z M 407.37 103 L 406.03 98 L 404 95.31 L 402 93.63 L 400 92.78 L 397 92.48 L 394 92.73 L 390.13 95 L 387.66 98 L 386.43 103 L 387 103.46 L 406 103.46 Z"
        fill={textFill}
        fillRule="evenodd"
        clipRule="evenodd"
      />
    </svg>
  )
}
