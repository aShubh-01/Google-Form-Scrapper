import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react()],
  preview: {
    allowedHosts: [
      'ec2-13-60-182-43.eu-north-1.compute.amazonaws.com'
    ]
  }
})
