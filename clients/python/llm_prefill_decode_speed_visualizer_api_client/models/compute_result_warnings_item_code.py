from enum import Enum

class ComputeResultWarningsItemCode(str, Enum):
    DECODE_ABOVE_BANDWIDTH_ROOFLINE = "decode_above_bandwidth_roofline"
    PREFILL_ABOVE_COMPUTE_ROOFLINE = "prefill_above_compute_roofline"
    TTFT_BELOW_KERNEL_LAUNCH_FLOOR = "ttft_below_kernel_launch_floor"

    def __str__(self) -> str:
        return str(self.value)
