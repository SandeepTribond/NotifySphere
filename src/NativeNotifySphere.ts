/**
 * TurboModule spec for NotifySphere.
 *
 * This file is intentionally minimal — all notification logic is implemented
 * in JavaScript (src/index.tsx) via @react-native-firebase/messaging and
 * @notifee/react-native. No native bridge methods are required.
 *
 * The module registration below is kept for New Architecture compatibility;
 * it allows the codegen to produce the required C++ glue code without
 * exposing any unnecessary native surface.
 */
import { TurboModuleRegistry, type TurboModule } from 'react-native';

export interface Spec extends TurboModule {}

export default TurboModuleRegistry.getEnforcing<Spec>('NotifySphere');
