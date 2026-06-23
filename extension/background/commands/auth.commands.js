// Auth / plan / linking commands. Each: async (message, ctx) => responseObject.

export const login = (m, ctx) => ctx.authService.login(m.username, m.password);
export const register = (m, ctx) => ctx.authService.register(m.username, m.password);
export const resendCode = (m, ctx) => ctx.authService.resendCode(m.username);
export const verifyEmail = (m, ctx) => ctx.authService.verifyEmail(m.code);
export const logout = (m, ctx) => ctx.authService.logout();
export const forgotPassword = (m, ctx) => ctx.authService.forgotPassword(m.email);
export const resetPassword = (m, ctx) => ctx.authService.resetPassword(m.email, m.code, m.newPassword);
export const getUserPlan = (m, ctx) => ctx.authService.getUserPlan();
export const upgradePlan = (m, ctx) => ctx.authService.upgradePlan();
export const linkGoogle = (m, ctx) => ctx.authService.linkGoogle(m.token);
export const getLinkStatus = (m, ctx) => ctx.authService.getLinkStatus();

export const getSession = async (m, ctx) => {
    const session = await ctx.authService.getSession();
    return { success: true, ...session };
};

export const getPlan = async (m, ctx) => {
    const authState = await ctx.authService.getAuthState();
    const plan = await ctx.authService.getPlan();
    return { success: true, plan, authState };
};
