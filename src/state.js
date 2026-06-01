export async function readState(bucket, statePrefix, uuid) {
  const obj = await bucket.get(`${statePrefix}/${uuid}`)
  if (!obj) return null
  return JSON.parse(await obj.text())
}

export async function writeState(bucket, statePrefix, uuid, state) {
  await bucket.put(`${statePrefix}/${uuid}`, JSON.stringify(state))
}

export async function deleteState(bucket, statePrefix, uuid) {
  await bucket.delete(`${statePrefix}/${uuid}`)
}
