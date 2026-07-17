import { memo } from 'react';
import styles from './LogisticsBackground.module.css';

/**
 * A premium, animated SVG background featuring a complex "spider-web" logistics network,
 * layered with depth (foreground/background) and flowing dots to represent supply chain movement.
 */
export const LogisticsBackground = memo(function LogisticsBackground() {
  return (
    <div className={styles.container} aria-hidden="true">
      <svg
        className={styles.svg}
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Layer 1: Background (Dim, Blurry, Slower, smaller) - gives Depth */}
        <g className={styles.layerBackground}>
          <path className={styles.path} d="M 100 100 L 400 300 L 250 600 L -50 450 Z" />
          <path className={styles.path} d="M 400 300 L 900 150 L 1100 400 L 700 500 Z" />
          <path className={styles.path} d="M 1100 400 L 1500 250 L 1300 700 L 800 850 Z" />
          <path className={styles.path} d="M 700 500 L 800 850 L 250 600" />

          {/* Background Nodes */}
          <circle cx="400" cy="300" r="16" className={styles.nodeGlow} />
          <circle cx="400" cy="300" r="4" className={styles.node} />

          <circle cx="250" cy="600" r="16" className={styles.nodeGlow} />
          <circle cx="250" cy="600" r="4" className={styles.node} />

          <circle cx="900" cy="150" r="16" className={styles.nodeGlow} />
          <circle cx="900" cy="150" r="4" className={styles.node} />

          <circle cx="1100" cy="400" r="16" className={styles.nodeGlow} />
          <circle cx="1100" cy="400" r="4" className={styles.node} />

          <circle cx="700" cy="500" r="16" className={styles.nodeGlow} />
          <circle cx="700" cy="500" r="4" className={styles.node} />

          <circle cx="800" cy="850" r="16" className={styles.nodeGlow} />
          <circle cx="800" cy="850" r="4" className={styles.node} />

          {/* Background Flowing Dots */}
          <circle r="2" className={styles.dot}>
            <animateMotion dur="40s" repeatCount="indefinite" path="M 100 100 L 400 300 L 900 150 L 1100 400" />
          </circle>
          <circle r="2" className={styles.dot}>
            <animateMotion dur="35s" repeatCount="indefinite" begin="5s" path="M 1500 250 L 1100 400 L 700 500 L 250 600" />
          </circle>
        </g>

        {/* Layer 2: Foreground (Sharp, Bright, Faster, larger) - Main Network */}
        <g className={styles.layerForeground}>
          {/* Main Network Paths */}
          <path className={styles.path} d="M -100 250 C 150 200, 300 400, 450 350 C 600 300, 800 150, 1050 250 C 1300 350, 1400 600, 1550 500" />
          <path className={styles.path} d="M 450 350 C 550 600, 350 800, 100 750" />
          <path className={styles.path} d="M 1050 250 C 950 500, 1150 800, 1400 850" />
          <path className={styles.path} d="M 450 350 L 750 600 L 1050 250" />

          {/* Foreground Nodes */}
          {/* Node 1 */}
          <circle cx="450" cy="350" r="32" className={styles.nodeGlow} />
          <circle cx="450" cy="350" r="8" className={styles.node} />
          <text x="450" y="310" textAnchor="middle" className={styles.label}>WareHouse</text>

          {/* Node 2 */}
          <circle cx="1050" cy="250" r="32" className={styles.nodeGlow} />
          <circle cx="1050" cy="250" r="8" className={styles.node} />
          <text x="1050" y="210" textAnchor="middle" className={styles.label}>Hajira Port</text>

          {/* Node 3 */}
          <circle cx="750" cy="600" r="32" className={styles.nodeGlow} />
          <circle cx="750" cy="600" r="8" className={styles.node} />
          <text x="750" y="560" textAnchor="middle" className={styles.label}>Dispatch Center</text>

          {/* Node 4 (Left edge) */}
          <circle cx="100" cy="750" r="24" className={styles.nodeGlow} />
          <circle cx="100" cy="750" r="6" className={styles.node} />
          <text x="100" y="715" textAnchor="middle" className={styles.label}>Factory A</text>

          {/* Node 5 (Right edge) */}
          <circle cx="1400" cy="850" r="24" className={styles.nodeGlow} />
          <circle cx="1400" cy="850" r="6" className={styles.node} />
          <text x="1400" y="815" textAnchor="middle" className={styles.label}>Warehouse B</text>

          {/* Foreground Flowing Dots */}
          <circle r="3" className={styles.dot}>
            <animateMotion dur="25s" repeatCount="indefinite" path="M -100 250 C 150 200, 300 400, 450 350 C 600 300, 800 150, 1050 250 C 1300 350, 1400 600, 1550 500" />
          </circle>

          <circle r="3" className={styles.dot}>
            <animateMotion dur="20s" repeatCount="indefinite" begin="2s" path="M 100 750 C 350 800, 550 600, 450 350 L 750 600 L 1050 250 C 1150 800, 950 500, 1400 850" />
          </circle>

          <circle r="3" className={styles.dot}>
            <animateMotion dur="15s" repeatCount="indefinite" begin="4s" path="M 1050 250 L 750 600 L 450 350" />
          </circle>
        </g>
      </svg>
    </div>
  );
});
