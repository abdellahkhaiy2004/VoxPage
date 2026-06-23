// Conversation history commands. Each: async (message, ctx) => responseObject.

export const getHistory = async (m, ctx) => ({
    success: true,
    history: await ctx.historyService.getHistory()
});

export const addHistory = async (m, ctx) => ({
    success: true,
    history: await ctx.historyService.addEntry(m.sender, m.message)
});

export const clearHistory = async (m, ctx) => {
    await ctx.historyService.clearHistory();
    return { success: true };
};
