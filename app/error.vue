<script setup lang="ts">
import type { NuxtError } from "#app";
import "~/assets/css/error.css";

// Shows only the status: never the error's message or stack, which may name a backend (REQ-009).
const props = defineProps<{ error: NuxtError }>();
const notFound = props.error.status === 404;
const heading = notFound ? "Page not found" : "This page isn't available right now";

useSeoMeta({ title: `${heading} · Reference Systems Lab` });
</script>

<template>
  <main class="error">
    <h1>{{ heading }}</h1>
    <p v-if="notFound">There's no page at this address.</p>
    <p v-else>Please try again in a moment.</p>
    <p><a href="/">Back to the home page</a></p>
  </main>
</template>
