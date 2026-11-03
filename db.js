const DATABASE_NAME = "qingpao";
const DATABASE_VERSION = 1;
const RUN_STORE = "runs";
const ACTIVE_STORE = "active";

let databasePromise;

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
}

function transactionAsPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error), { once: true });
  });
}

export function openDatabase() {
  if (!("indexedDB" in window)) {
    return Promise.reject(new Error("当前浏览器不支持本地数据库。"));
  }

  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(RUN_STORE)) {
        const store = database.createObjectStore(RUN_STORE, { keyPath: "id" });
        store.createIndex("startedAt", "startedAt", { unique: false });
      }
      if (!database.objectStoreNames.contains(ACTIVE_STORE)) {
        database.createObjectStore(ACTIVE_STORE, { keyPath: "key" });
      }
    });

    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
    request.addEventListener("blocked", () => {
      reject(new Error("数据库被其他页面占用，请关闭旧页面后重试。"));
    });
  });

  return databasePromise;
}

export async function getAllRuns() {
  const database = await openDatabase();
  const transaction = database.transaction(RUN_STORE, "readonly");
  const index = transaction.objectStore(RUN_STORE).index("startedAt");
  const request = index.openCursor(null, "prev");
  const runs = [];

  await new Promise((resolve, reject) => {
    request.addEventListener("success", () => {
      const cursor = request.result;
      if (cursor) {
        runs.push(cursor.value);
        cursor.continue();
      } else {
        resolve();
      }
    });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });

  return runs;
}

export async function getRun(id) {
  const database = await openDatabase();
  const transaction = database.transaction(RUN_STORE, "readonly");
  return requestAsPromise(transaction.objectStore(RUN_STORE).get(id));
}

export async function saveRun(run) {
  const database = await openDatabase();
  const transaction = database.transaction(RUN_STORE, "readwrite");
  transaction.objectStore(RUN_STORE).put(run);
  await transactionAsPromise(transaction);
  return run;
}

export async function saveActiveRun(activeRun) {
  const database = await openDatabase();
  const transaction = database.transaction(ACTIVE_STORE, "readwrite");
  transaction.objectStore(ACTIVE_STORE).put({
    key: "current",
    ...activeRun,
    updatedAt: Date.now(),
  });
  await transactionAsPromise(transaction);
}

export async function getActiveRun() {
  const database = await openDatabase();
  const transaction = database.transaction(ACTIVE_STORE, "readonly");
  const result = await requestAsPromise(transaction.objectStore(ACTIVE_STORE).get("current"));
  if (!result) {
    return null;
  }
  const { key, ...activeRun } = result;
  return activeRun;
}

export async function clearActiveRun() {
  const database = await openDatabase();
  const transaction = database.transaction(ACTIVE_STORE, "readwrite");
  transaction.objectStore(ACTIVE_STORE).delete("current");
  await transactionAsPromise(transaction);
}
