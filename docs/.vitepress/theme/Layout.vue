<script setup lang="ts">
import { defineAsyncComponent } from 'vue';
import DefaultTheme from 'vitepress/theme';

const ProductShowcase = defineAsyncComponent(() => import('./ProductShowcase.vue'));
</script>

<template>
  <DefaultTheme.Layout>
    <template #home-features-before>
      <ProductShowcase />
    </template>
  </DefaultTheme.Layout>
</template>
