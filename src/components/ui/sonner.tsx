import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group toast justify-center group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          content: "max-w-[calc(100%-2rem)] flex-none text-center [&_*]:text-center",
          title: "text-center",
          description: "w-full text-center group-[.toast]:text-muted-foreground",
          actionButton: "justify-center text-center group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "justify-center text-center group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
