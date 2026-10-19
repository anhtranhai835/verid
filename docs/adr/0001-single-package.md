# ADR-0001: Một package duy nhất

- Trạng thái: Accepted, 2026-10-19

## Bối cảnh
verid chỉ có một sản phẩm là CLI kèm hook. haren dùng monorepo pnpm (`apps/cli` + `packages/shared`).

## Quyết định
Dùng một package npm duy nhất. Mã nằm trong `src/{core,adapters,cli}` và `src/hook.ts`.

## Lựa chọn thay thế
Monorepo giống haren: tốn thêm cấu hình build và publish, trong khi chưa có package thứ hai nào cần tách ra.

## Hệ quả
Build và publish đơn giản hơn. Khi thật sự có package thứ hai, ví dụ adapter cho agent khác, sẽ cân nhắc tách sau.
