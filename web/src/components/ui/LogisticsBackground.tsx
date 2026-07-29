// import { memo, type ReactNode } from 'react';
// import styles from './LogisticsBackground.module.css';

// interface LogisticsLayoutProps {
//   children?: ReactNode;
// }

// export const LogisticsBackground = memo(function LogisticsBackground({
//   children,
// }: LogisticsLayoutProps) {
//   const currentYear = new Date().getFullYear();

//   return (
//     <div className={styles.pageWrapper}>
//       {/* Background Shapes & Grid Dots */}
//       <div className={styles.bgPattern} />
//       <div className={styles.subShape} />
//       <div className={styles.dotGridLeft} />
//       <div className={styles.dotGridRight} />

//       {/* Main Centered Card Container */}
//       <div className={styles.cardContainer}>
//         <div className={styles.authCard}>
//           {children}
//         </div>
//       </div>

//       {/* Bottom Copyright Footer */}
//       <footer className={styles.pageCopyright}>
//         © {currentYear}, OCTFIS Techno LLP. All Rights Reserved.
//       </footer>
//     </div>
//   );
// });
// ================
// import { memo, type ReactNode } from 'react';
// import styles from './LogisticsBackground.module.css';

// interface LogisticsLayoutProps {
//   children?: ReactNode;
// }

// export const LogisticsBackground = memo(function LogisticsBackground({
//   children,
// }: LogisticsLayoutProps) {
//   const currentYear = new Date().getFullYear();

//   return (
//     <div className={styles.pageWrapper}>
//       {/* Main Large Corner Cubes */}
//       <div className={`${styles.cube} ${styles.cubeTopLeft}`} />
//       <div className={`${styles.cube} ${styles.cubeBottomRight}`} />
//       <div className={`${styles.cube} ${styles.cubeBottomLeft}`} />
      
//       {/* Floating 3D Cubes Near Form */}
//       <div className={`${styles.cube} ${styles.cubeNearFormTopRight}`} />
//       <div className={`${styles.cube} ${styles.cubeNearFormMidLeft}`} />
//       <div className={`${styles.cube} ${styles.cubeNearFormBottomRight}`} />

//       {/* Floating Dot Grids */}
//       <div className={styles.dotGridLeft} />
//       <div className={styles.dotGridRight} />

//       {/* Main Centered Card Container */}
//       <div className={styles.cardContainer}>
//         <div className={styles.authCard}>
//           {children}
//         </div>
//       </div>

//       {/* Bottom Copyright Footer */}
//       <footer className={styles.pageCopyright}>
//         © {currentYear}, OCTFIS Techno LLP. All Rights Reserved.
//       </footer>
//     </div>
//   );
// });

import { memo, type ReactNode } from 'react';
import styles from './LogisticsBackground.module.css';

interface LogisticsLayoutProps {
  children?: ReactNode;
}

export const LogisticsBackground = memo(function LogisticsBackground({
  children,
}: LogisticsLayoutProps) {
  const currentYear = new Date().getFullYear();

  return (
    <div className={styles.pageWrapper}>
      {/* Corner Cubes */}
      <div className={`${styles.cube} ${styles.cubeTopLeft}`} />
      <div className={`${styles.cube} ${styles.cubeBottomRight}`} />
      <div className={`${styles.cube} ${styles.cubeBottomLeft}`} />

      {/* Cube Peeking Behind Form (Matching top-left volumetric style) */}
      <div className={`${styles.cube} ${styles.cubeBehindForm}`} />

      {/* Floating 3D Cubes Near Form (Cleaned Up) */}
      <div className={`${styles.cube} ${styles.cubeNearFormTopRight}`} />
      <div className={`${styles.cube} ${styles.cubeNearFormBottomRight}`} />

      {/* Floating Dot Grids (Rendered BEHIND Cubes with z-index: 0) */}
      <div className={styles.dotGridTopLeft} />
      <div className={styles.dotGridBetweenFormAndCubeRight} />
      <div className={styles.dotGridBetweenFormAndCubeLeft} />

      {/* Main Centered Card Container */}
      <div className={styles.cardContainer}>
        <div className={styles.authCard}>{children}</div>
      </div>

      {/* Bottom Copyright Footer */}
      <footer className={styles.pageCopyright}>
        © {currentYear}, OCTFIS Techno LLP. All Rights Reserved.
      </footer>
    </div>
  );
});