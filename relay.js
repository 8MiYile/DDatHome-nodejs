const { KeepLiveWS } = require('bilibili-live-ws')
const { getConf: getConfW } = require('bilibili-live-ws/extra')

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

module.exports = home => {
  const log = (...msg) => {
    home.emit('log', 'relay', ...msg)
    home.emit('relay', ...msg)
  }
  const send = relay => home.secureSend(JSON.stringify({ relay }))

  const waiting = []
  const rooms = new Set()
  const lived = new Set()
  const printStatus = () => {
    log(`living/opening: ${lived.size}/${rooms.size}`)
  }

  const processWaiting = async () => {
    while (waiting.length) {
      await wait(1800)
      const { f, resolve, roomid } = waiting.shift()
      f().then(resolve).catch(() => {
        log('redo', roomid)
        waiting.push({ f, resolve, roomid })
        if (waiting.length === 1) {
          processWaiting()
        }
      })
    }
  }

  const getConf = roomid => {
    const p = new Promise(resolve => waiting.push({ resolve, f: () => getConfW(roomid), roomid }))
    if (waiting.length === 1) {
      processWaiting()
    }
    return p
  }

  const openRoom = async roomid => {
    const { address, key } = await getConf(roomid)
    log(`OPEN: ${roomid}`)
    printStatus()
    const live = new KeepLiveWS(roomid, { address, key })
    live.interval = 60 * 1000
    live.on('live', () => {
      log(`LIVE: ${roomid}`)
      lived.add(roomid)
      printStatus()
    })
    live.on('error', () => {
      log(`ERROR: ${roomid}`)
      lived.delete(roomid)
      printStatus()
    })
    live.on('close', async () => {
      log(`CLOSE: ${roomid}`)
      lived.delete(roomid)
      printStatus()
      const { address, key } = await getConf(roomid)
      live.params[1] = { key, address }
    })

    live.on('LIVE', () => send({ roomid, e: 'LIVE' }))
    live.on('PREPARING', () => send({ roomid, e: 'PREPARING' }))
    live.on('ROUND', () => send({ roomid, e: 'ROUND' }))
    live.on('heartbeat', online => send({ roomid, e: 'heartbeat', data: online }))

    live.on('ROOM_CHANGE', ({ data: { title } }) => send({ roomid, e: 'ROOM_CHANGE', data: title, token: `${roomid}_ROOM_CHANGE_${title}` }))
    live.on('DANMU_MSG', async ({ info }) => {
      if (!info[0][9]) {
        const message = info[1]
        const mid = info[2][0]
        const uname = info[2][1]
        const timestamp = info[0][4]

        const token = `${roomid}_DANMU_MSG_${mid}_${timestamp}`
        send({ roomid, e: 'DANMU_MSG', data: { message, uname, timestamp, mid }, token })
      }
    })
    live.on('SEND_GIFT', ({ data }) => {
      const coinType = data.coin_type
      const mid = data.uid
      const giftId = data.giftId
      const totalCoin = data.total_coin
      const uname = data.uname

      const tid = data.tid
      const token = `${roomid}_SEND_GIFT_${mid}_${tid}`
      send({ roomid, e: 'SEND_GIFT', data: { coinType, giftId, totalCoin, uname, mid }, token })
    })
    live.on('GUARD_BUY', ({ data }) => {
      const mid = data.uid
      const uname = data.username
      const num = data.num
      const price = data.price
      const giftId = data.gift_id
      const level = data.guard_level

      const time = data.start_time
      const token = `${roomid}_GUARD_BUY_${mid}_${time}`
      send({ roomid, e: 'GUARD_BUY', data: { mid, uname, num, price, giftId, level }, token })
    })
  }

  const watch = roomid => {
    if (roomid && !rooms.has(roomid)) {
      rooms.add(roomid)
      log(`WATCH: ${roomid}`)
      openRoom(roomid)
    }
  }

  home.once('open', () => {
    setInterval(() => {
      if (rooms.size === lived.size) {
        home.ask({ type: 'pickRoom' }).then(roomid => watch(roomid))
      }
    }, 5 * 1000)
  })
}
