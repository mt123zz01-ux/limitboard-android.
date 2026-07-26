class ClientTickSync {
  constructor(client, isActive = () => true, onError = () => {}) {
    this.client = client
    this.isActive = isActive
    this.onError = onError
    this.timer = null
    this.errorReported = false
  }

  sendTickEnd() {
    if (!this.isActive()) return false
    try {
      this.client.write('tick_end', {})
      return true
    } catch (error) {
      if (!this.errorReported) {
        this.errorReported = true
        this.onError(error)
      }
      return false
    }
  }

  start() {
    if (this.timer) return
    this.errorReported = false
    this.timer = setInterval(() => this.sendTickEnd(), 50)
    this.timer.unref?.()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

module.exports = { ClientTickSync }
