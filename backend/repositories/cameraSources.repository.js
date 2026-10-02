const { createRepository, dateValue } = require("./base.repository");
const { encryptCameraSecrets } = require("../services/cameraSecrets.service");

module.exports = createRepository({
  table: "camera_sources",
  jsonKey: "cameraSources",
  serialize: (record) => {
    const stored = { ...record };
    encryptCameraSecrets(stored);
    return stored;
  },
  columns: [
    { name: "status", value: (item) => item.status || null },
    { name: "source_type", value: (item) => item.type || null },
    { name: "updated_at", value: (item) => dateValue(item.lastSeenAt || item.lastTestedAt) }
  ]
});
