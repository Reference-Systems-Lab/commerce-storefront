<script setup lang="ts">
import "~/assets/css/products.css";

useSeoMeta({
  title: "Products · Reference Systems Lab",
  description: "Every product in the catalog, with its current price.",
});

const { data } = await useProducts();
const catalog = data.value;
if (!catalog?.ok) {
  // The generic error page; nothing about the backend reaches the browser (REQ-009).
  throw createError({ status: 503, statusText: "Service Unavailable", fatal: true });
}
const products = catalog.items;
</script>

<template>
  <main>
    <h1>Products</h1>
    <!-- WebKit drops a list's role when list-style is none, so it is set explicitly. -->
    <!-- eslint-disable-next-line vuejs-accessibility/no-redundant-roles -->
    <ul class="products" role="list">
      <li
        v-for="product in products"
        :key="product.slug"
        class="product"
        :data-product="product.slug"
      >
        <span class="product-name">{{ product.name }}</span
        >{{ ", " }}<span class="product-price">{{ product.priceLabel }}</span>
      </li>
    </ul>
    <p><a href="/">Home</a></p>
  </main>
</template>
