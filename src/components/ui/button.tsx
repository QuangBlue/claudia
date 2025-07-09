import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Button variants configuration using class-variance-authority
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "shadow",
        destructive: "shadow-xs",
        outline: "border shadow-xs",
        secondary: "shadow-xs",
        ghost: "",
        link: "underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

/**
 * Button component with multiple variants and sizes
 *
 * @example
 * <Button variant="outline" size="lg" onClick={() => console.log('clicked')}>
 *   Click me
 * </Button>
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, style, ...props }, ref) => {
    // Get theme-aware styles
    const getVariantStyles = (variant: string) => {
      switch (variant) {
        case "default":
          return {
            backgroundColor: "var(--color-primary)",
            color: "var(--color-primary-foreground)",
            borderColor: "transparent",
          };
        case "destructive":
          return {
            backgroundColor: "var(--color-destructive)",
            color: "var(--color-destructive-foreground)",
            borderColor: "transparent",
          };
        case "outline":
          return {
            backgroundColor: "var(--color-card)",
            color: "var(--color-foreground)",
            borderColor: "var(--color-input)",
          };
        case "secondary":
          return {
            backgroundColor: "var(--color-secondary)",
            color: "var(--color-secondary-foreground)",
            borderColor: "transparent",
          };
        case "ghost":
          return {
            backgroundColor: "var(--color-card)",
            color: "var(--color-foreground)",
            borderColor: "transparent",
          };
        case "link":
          return {
            backgroundColor: "var(--color-card)",
            color: "var(--color-primary)",
            borderColor: "transparent",
          };
        default:
          return {
            backgroundColor: "var(--color-primary)",
            color: "var(--color-primary-foreground)",
            borderColor: "transparent",
          };
      }
    };

    const variantStyles = getVariantStyles(variant || "default");

    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        style={{
          ...variantStyles,
          ...style,
        }}
        onMouseEnter={(e) => {
          const target = e.currentTarget;
          switch (variant) {
            case "outline":
            case "ghost":

            default:
              target.style.opacity = "0.9";
              break;
          }
        }}
        onMouseLeave={(e) => {
          const target = e.currentTarget;
          const resetStyles = getVariantStyles(variant || "default");
          target.style.backgroundColor = resetStyles.backgroundColor;
          target.style.color = resetStyles.color;
          target.style.opacity = "1";
        }}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
