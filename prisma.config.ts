// 1. THIS IS THE MISSING LINK: It loads your .env file
import "dotenv/config";
import { defineConfig, env } from "@prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // 2. Now 'env' will be able to find the DATABASE_URL
    url: env("DATABASE_URL"),
  },
});