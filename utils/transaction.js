const mongoose = require('mongoose');

const ensureConnected = async (connection = mongoose.connection) => {
  if (connection.readyState === 1) return connection;
  if (connection.readyState === 2) {
    await connection.asPromise();
    return connection;
  }
  if (connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
    return mongoose.connection;
  }
  await connection.asPromise();
  return connection;
};

const supportsTransactions = (connection = mongoose.connection) => {
  const topologyType = connection?.getClient?.()?.topology?.description?.type;
  return topologyType === 'ReplicaSetWithPrimary' || topologyType === 'Sharded';
};

const runInTransaction = async (work, options = {}) => {
  const connection = await ensureConnected(options.connection || mongoose.connection);
  const canUseTransactions = supportsTransactions(connection);
  const fallbackToNonTransactional = options.fallbackToNonTransactional ?? process.env.NODE_ENV !== 'production';

  if (!canUseTransactions) {
    if (!fallbackToNonTransactional) {
      throw new Error('MongoDB transactions are unavailable for the current connection topology');
    }

    if (options.logger) {
      options.logger('[mongo] Transactions unavailable for the current topology; using non-transactional writes');
    }
    return work(null);
  }

  const session = await connection.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};

module.exports = {
  ensureConnected,
  supportsTransactions,
  runInTransaction,
};
