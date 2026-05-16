import apiClient from './client'

export interface GpioRelayCommand {
  slot: string
  pin: number
  state: boolean
  durationMs?: number
}

export const gpioApi = {
  sendRelayCommand: (gatewayId: string, cmd: GpioRelayCommand) =>
    apiClient.post<{ success: boolean; message: string }>(`/gpio/${gatewayId}/relay`, cmd),
}
