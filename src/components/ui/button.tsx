import * as React from "react"
import { Slot } from "radix-ui"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3",
      },
    },
    defaultVariants: {
      variant: "outline",
      size: "default",
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  type = "button",
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      type={type}
      {...props}
    />
  )
}

export { Button }
