// Reader catalog commands. Each: async (message, ctx) => responseObject.

export const getReaders = async (m, ctx) => {
    const readers = await ctx.readerService.getAllReaders();
    const selectedReaderId = await ctx.readerService.getSelectedReaderId();
    return { success: true, readers, selectedReaderId };
};

export const setReader = async (m, ctx) => {
    const ok = await ctx.readerService.setReader(m.readerId);
    return { success: ok };
};
