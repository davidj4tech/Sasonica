<template>
  <!--
    Sasonica: the commands matching what has been typed after a `/`, above the
    box. Newest-style command palette: the best match first, a tap fills it in.
  -->
  <div v-if="commands.length" class="w-full mb-1.5 rounded-sm border border-border bg-primary overflow-hidden">
    <div v-for="(command, index) in commands" :key="command.name" class="flex items-baseline px-2 py-1.5 border-b border-border last:border-b-0" :class="index === selected ? 'bg-bg' : ''" @click="command.unavailable || $emit('select', command)">
      <p v-if="command.unavailable" class="text-xs text-fg-muted">{{ command.description }}</p>
      <p v-else class="text-sm text-fg flex-shrink-0">/{{ command.name }}<span v-if="command.aliases && command.aliases.length" class="text-fg-muted"> ({{ command.aliases.join(', ') }})</span></p>
      <p v-if="command.description && !command.unavailable" class="text-xs text-fg-muted pl-2 truncate">{{ command.description }}</p>
      <div class="flex-grow" />
      <span v-if="command.terminal" class="material-symbols text-sm text-fg-muted pl-1" title="terminal only">terminal</span>
    </div>
  </div>
</template>

<script>
export default {
  props: {
    commands: {
      type: Array,
      default: () => []
    },
    // Which row the keyboard is on. A tap picks whatever it touches, so this
    // only matters with arrow keys attached.
    selected: {
      type: Number,
      default: 0
    }
  }
}
</script>
