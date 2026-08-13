export function useCommercialSetupAccount() {
  return {
    accountStatus: 'signed-out' as const,
    available: false,
    loading: false,
    operation: null,
    error: null,
    clearError: () => undefined,
    createAccount: async () => undefined,
    signIn: async () => undefined,
    cancelAuthentication: async () => undefined,
  }
}
