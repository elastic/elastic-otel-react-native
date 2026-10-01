package co.elastic.otel.reactnative

internal class SpanHandleStore<T>(
    private val end: (T) -> Unit,
) {
    private var nextId = 1L
    private val values = mutableMapOf<String, T>()

    @Synchronized
    fun retain(value: T): String {
        val handle = "span-${nextId++}"
        values[handle] = value
        return handle
    }

    @Synchronized
    fun <R> withActive(handle: String, block: (T) -> R): R {
        val value = values[handle]
            ?: throw BootstrapException("Unknown or already-ended span handle: $handle")
        return block(value)
    }

    @Synchronized
    fun end(handle: String) {
        val value = values.remove(handle)
            ?: throw BootstrapException("Unknown or already-ended span handle: $handle")
        end(value)
    }
}
