import { arktypeResolver } from "@hookform/resolvers/arktype";
import { useMutation } from "@tanstack/react-query";
import { type } from "arktype";
import { Plus, UserPlus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "~/client/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "~/client/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "~/client/components/ui/form";
import { Input } from "~/client/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { authClient } from "~/client/lib/auth-client";

const createUserSchema = type({
	name: "string>=1",
	username: "string>=1",
	email: "string",
	password: "string>=8",
	role: "'user'|'admin'",
});

type CreateUserFormValues = typeof createUserSchema.infer;

interface CreateUserDialogProps {
	onUserCreated?: () => void;
}

export function CreateUserDialog({ onUserCreated }: CreateUserDialogProps) {
	const [isOpen, setIsOpen] = useState(false);

	const form = useForm<CreateUserFormValues>({
		resolver: arktypeResolver(createUserSchema),
		defaultValues: {
			name: "",
			username: "",
			email: "",
			password: "",
			role: "user",
		},
	});

	const createUserMutation = useMutation({
		mutationFn: async (values: CreateUserFormValues) => {
			const { error } = await authClient.admin.createUser({
				email: values.email,
				password: values.password,
				name: values.name,
				role: values.role,
				data: { username: values.username },
			});

			if (error) {
				throw new Error(error.message);
			}
		},
		onSuccess: () => {
			toast.success("User created successfully");
			setIsOpen(false);
			form.reset();
			onUserCreated?.();
		},
		onError: (error: Error) => {
			toast.error("Failed to create user", { description: error.message });
		},
	});

	return (
		<Dialog open={isOpen} onOpenChange={setIsOpen}>
			<DialogTrigger asChild>
				<Button size="sm">
					<Plus className="mr-2 h-4 w-4" />
					Create User
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-106.25">
				<Form {...form}>
					<form onSubmit={form.handleSubmit((values) => createUserMutation.mutate(values))} className="space-y-6">
						<DialogHeader>
							<DialogTitle className="flex items-center gap-2">
								<UserPlus className="h-5 w-5" />
								Create New User
							</DialogTitle>
							<DialogDescription>Fill in the details to create a new user account.</DialogDescription>
						</DialogHeader>
						<div className="grid gap-4 py-4">
							<FormField
								control={form.control}
								name="name"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Full Name</FormLabel>
										<FormControl>
											<Input {...field} placeholder="John Doe" disabled={createUserMutation.isPending} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="username"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Username</FormLabel>
										<FormControl>
											<Input {...field} placeholder="johndoe" disabled={createUserMutation.isPending} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="email"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Email</FormLabel>
										<FormControl>
											<Input
												{...field}
												type="email"
												placeholder="john@example.com"
												disabled={createUserMutation.isPending}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="password"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Password</FormLabel>
										<FormControl>
											<Input
												{...field}
												type="password"
												placeholder="Min. 8 characters"
												disabled={createUserMutation.isPending}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="role"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Role</FormLabel>
										<Select onValueChange={field.onChange} value={field.value} disabled={createUserMutation.isPending}>
											<FormControl>
												<SelectTrigger>
													<SelectValue placeholder="Select a role" />
												</SelectTrigger>
											</FormControl>
											<SelectContent>
												<SelectItem value="user">User</SelectItem>
												<SelectItem value="admin">Admin</SelectItem>
											</SelectContent>
										</Select>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setIsOpen(false)}
								disabled={createUserMutation.isPending}
							>
								Cancel
							</Button>
							<Button type="submit" loading={createUserMutation.isPending}>
								<UserPlus className="mr-2 h-4 w-4" />
								Create User
							</Button>
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
}
