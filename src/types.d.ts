declare module 'react-native-install-referrer' {
  const RNInstallReferrer: {
    getReferrer: () => Promise<{ installReferrer?: string }>;
  };
  export default RNInstallReferrer;
}
